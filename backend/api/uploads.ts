import multer from "multer";
import { mkdirSync } from "node:fs";
import { extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { UPLOADS_DIR } from "../paths.js";

mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname) || ".jpg"}`),
});

export const uploadImage = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error("Unsupported image type. Upload a JPEG, PNG, WEBP or HEIC photo."));
      return;
    }
    cb(null, true);
  },
});

export function uploadPathToUrl(absolutePath: string): string {
  const filename = absolutePath.split("/").pop()!;
  return `/uploads/${filename}`;
}

export function resolveUploadPath(filename: string): string {
  return resolve(UPLOADS_DIR, filename);
}
