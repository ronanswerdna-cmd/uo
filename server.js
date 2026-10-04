// Prisca Ravoarrimanana - YouTube Downloader : serveur
const express = require('express');
const cors = require('cors');
const youtubedl = require('youtube-dl-exec');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const cleanName = (s) =>
  (s || 'video').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || 'video';

function validateUrl(req, res, next) {
  const value = req.query.url;
  if (typeof value !== 'string') {
    return res.status(400).json({ error: "Colle l'adresse complète d'une vidéo YouTube." });
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return res.status(400).json({ error: "Colle l'adresse complète d'une vidéo YouTube." });
  }

  const host = url.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) ||
      !(host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be')) {
    return res.status(400).json({ error: 'Le lien doit pointer vers youtube.com ou youtu.be.' });
  }

  req.videoUrl = url.toString();
  next();
}

function explainError(err) {
  const details = String(err && (err.stderr || err.message) || err);
  if (/private|members.only/i.test(details)) return 'Cette vidéo est privée ou réservée aux membres.';
  if (/age|sign in to confirm your age/i.test(details)) return 'Cette vidéo est soumise à une restriction d’âge.';
  if (/unavailable|not available|removed/i.test(details)) return "Cette vidéo n'est pas disponible.";
  if (/sign in|bot|429|403|confirm you.re not a bot/i.test(details)) {
    return 'YouTube refuse actuellement la lecture de cette vidéo. Réessaie plus tard.';
  }
  if (/ffmpeg|merg|postprocess/i.test(details)) {
    return 'Impossible de fusionner les pistes vidéo et audio en MP4.';
  }
  const usefulLine = details.split(/\r?\n/).filter((line) => /error:/i.test(line)).pop();
  return usefulLine
    ? `Échec du téléchargement : ${usefulLine.trim().slice(0, 240)}`
    : 'Impossible de télécharger cette vidéo pour le moment.';
}

app.get('/api/download', validateUrl, async (req, res) => {
  let tempDir;
  let subprocess;
  const stopOnDisconnect = () => {
    if (!res.writableEnded && subprocess && subprocess.kill) subprocess.kill();
  };

  try {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'prisca-youtube-'));
    subprocess = youtubedl.exec(
      req.videoUrl,
      {
        format: 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]',
        output: path.join(tempDir, '%(title).100B.%(ext)s'),
        mergeOutputFormat: 'mp4',
        remuxVideo: 'mp4',
        ffmpegLocation: ffmpegPath,
        noPlaylist: true,
        noWarnings: true,
        noProgress: true,
      },
      { windowsHide: true }
    );
    res.once('close', stopOnDisconnect);
    await subprocess;
    res.removeListener('close', stopOnDisconnect);

    const files = await fs.promises.readdir(tempDir);
    const videoName = files.find((name) => name.toLowerCase().endsWith('.mp4'));
    if (!videoName) throw new Error('yt-dlp n’a créé aucun fichier MP4.');

    const videoPath = path.join(tempDir, videoName);
    const videoStat = await fs.promises.stat(videoPath);
    if (!videoStat.isFile() || videoStat.size === 0) {
      throw new Error('Le fichier vidéo créé est vide ou invalide.');
    }

    const downloadName = `${cleanName(path.parse(videoName).name)}.mp4`;
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', videoStat.size);
    res.download(videoPath, downloadName, (err) => {
      fs.promises.rm(tempDir, { recursive: true, force: true }).catch((cleanupError) => {
        console.error('nettoyage:', cleanupError.message);
      });
      if (err) {
        console.error('envoi:', err.message);
        if (!res.headersSent && !res.destroyed) {
          res.status(500).json({ error: 'La vidéo a été créée, mais son envoi a échoué.' });
        } else if (!res.destroyed) res.destroy(err);
      }
    });
  } catch (err) {
    if (tempDir) {
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch((cleanupError) => {
        console.error('nettoyage:', cleanupError.message);
      });
    }
    if (res.destroyed) return;
    console.error('téléchargement:', err && (err.stderr || err.message) || err);
    if (!res.headersSent) res.status(502).json({ error: explainError(err) });
    else res.destroy(err);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nPrisca Ravoarrimanana - YouTube Downloader`);
  console.log(`PC      : http://localhost:${PORT}`);
  Object.values(os.networkInterfaces())
    .flat()
    .filter((n) => n.family === 'IPv4' && !n.internal)
    .forEach((n) => console.log(`iPhone  : http://${n.address}:${PORT}`));
  console.log('');
});
