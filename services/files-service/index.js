const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");

const PORT = process.env.PORT || 5004;
const REGION = process.env.AWS_REGION || "us-east-1";
const BUCKET = process.env.S3_BUCKET || "";
const PREFIX = (process.env.S3_PREFIX || "").replace(/\/+$/, "");
const MAX_MB = Number(process.env.FILE_MAX_MB || 10);
const MAX_BYTES = Math.max(1, MAX_MB) * 1024 * 1024;

const s3Client = new S3Client({ region: REGION });

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
});

const app = express();
app.use(cors());

const ensureBucket = (res) => {
  if (!BUCKET) {
    res.status(500).send({ ok: false, error: "S3_BUCKET is not configured" });
    return false;
  }
  return true;
};

const sanitizeFilename = (name) => {
  const base = String(name || "file").trim();
  const sanitized = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized || "file";
};

const buildKey = (filename) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = sanitizeFilename(filename);
  const rawKey = `${stamp}-${safeName}`;
  if (!PREFIX) return rawKey;
  return `${PREFIX}/${rawKey}`;
};

const streamToResponse = (stream, res) =>
  new Promise((resolve, reject) => {
    stream.on("error", reject);
    stream.on("end", resolve);
    stream.pipe(res);
  });

app.get("/healthz", (req, res) => {
  res.send({ ok: true, bucket: BUCKET || null, region: REGION });
});

app.get(["/list", "/files"], async (req, res) => {
  if (!ensureBucket(res)) return;
  const maxKeys = Math.min(200, Number(req.query.limit || 50));
  try {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: PREFIX || undefined,
      MaxKeys: maxKeys,
    });
    const result = await s3Client.send(command);
    const contents = result.Contents || [];
    res.send({
      files: contents.map((item) => ({
        key: item.Key,
        size: item.Size,
        lastModified: item.LastModified ? item.LastModified.toISOString() : null,
      })),
    });
  } catch (err) {
    res.status(500).send({ ok: false, error: err.message || "Failed to list files" });
  }
});

app.post("/upload", upload.single("file"), async (req, res) => {
  if (!ensureBucket(res)) return;
  if (!req.file) {
    return res.status(400).send({ ok: false, error: "File is required" });
  }
  const keyOverride = req.body && req.body.key ? String(req.body.key).trim() : "";
  const key = keyOverride || buildKey(req.file.originalname);
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || "application/octet-stream",
    });
    await s3Client.send(command);
    res.send({
      ok: true,
      file: {
        key,
        size: req.file.size,
        contentType: req.file.mimetype,
      },
    });
  } catch (err) {
    res.status(500).send({ ok: false, error: err.message || "Failed to upload" });
  }
});

app.get("/download", async (req, res) => {
  if (!ensureBucket(res)) return;
  const rawKey = req.query.key ? String(req.query.key) : "";
  const key = decodeURIComponent(rawKey || "").trim();
  if (!key) {
    return res.status(400).send({ ok: false, error: "key query param is required" });
  }
  try {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const result = await s3Client.send(command);
    const filename = path.basename(key);
    res.setHeader("Content-Type", result.ContentType || "application/octet-stream");
    if (result.ContentLength) {
      res.setHeader("Content-Length", result.ContentLength);
    }
    res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
    await streamToResponse(result.Body, res);
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode || 500;
    res.status(status).send({ ok: false, error: err.message || "Failed to download" });
  }
});

app.listen(PORT, () => {
  console.log(`Files service listening on :${PORT}`);
});
