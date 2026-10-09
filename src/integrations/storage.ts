import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { errors } from "../common/errors";
import { env } from "../config/env";

const client = new S3Client({ region: env.AWS_REGION });
const extensions: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const createDocumentUpload = async (
  namespace: "driver-documents" | "vehicle-documents",
  ownerId: string,
  contentType: string,
  sizeBytes: number,
) => {
  const extension = extensions[contentType];
  if (!extension) throw errors.badRequest("Unsupported document type");
  if (sizeBytes <= 0 || sizeBytes > 10 * 1024 * 1024) {
    throw errors.badRequest("Document must not exceed 10 MB");
  }
  if (true || !env.AWS_S3_BUCKET) {
    // DISABLED S3 FOR NOW
    throw errors.unavailable("Document storage is not configured");
  }
  const key = `${namespace}/${ownerId}/${randomUUID()}.${extension}`;
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
      ServerSideEncryption: "AES256",
      Metadata: { ownerId },
    }),
    { expiresIn: 300 },
  );
  return { key, uploadUrl, expiresInSeconds: 300 };
};

export const uploadDriverDocument = async (
  ownerId: string,
  contentType: string,
  body: Buffer,
) => {
  const extension = extensions[contentType];
  if (!extension) throw errors.badRequest("Unsupported document type");
  if (body.length <= 0 || body.length > 5 * 1024 * 1024) {
    throw errors.badRequest("Document must not exceed 5 MB");
  }

  const key = `driver-documents/${ownerId}/${randomUUID()}.${extension}`;

  if (true || !env.AWS_S3_BUCKET) {
    // DISABLED S3 FOR NOW
    const fs = require("fs");
    const path = require("path");
    const filePath = path.join(process.cwd(), ".uploads", key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, body);

    const baseUrl =
      env.NODE_ENV === "production"
        ? "https://tuk.technogigz.co.in"
        : `http://localhost:${env.PORT}`;
    return {
      key,
      uploadUrl: `${baseUrl}/images/${key}`,
    };
  }

  await client.send(
    new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: body.length,
      ServerSideEncryption: "AES256",
      Metadata: { ownerId },
    }),
  );

  return {
    key,
    uploadUrl: `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`,
  };
};

export const uploadVehicleDocument = async (
  ownerId: string,
  contentType: string,
  body: Buffer,
) => {
  const extension = extensions[contentType];
  if (!extension) throw errors.badRequest("Unsupported document type");
  if (body.length <= 0 || body.length > 5 * 1024 * 1024) {
    throw errors.badRequest("Document must not exceed 5 MB");
  }

  const key = `vehicle-documents/${ownerId}/${randomUUID()}.${extension}`;

  if (true || !env.AWS_S3_BUCKET) {
    // DISABLED S3 FOR NOW
    const fs = require("fs");
    const path = require("path");
    const filePath = path.join(process.cwd(), ".uploads", key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, body);

    const baseUrl =
      env.NODE_ENV === "production"
        ? "https://tuk.technogigz.co.in"
        : `http://localhost:${env.PORT}`;
    return {
      key,
      uploadUrl: `${baseUrl}/images/${key}`,
    };
  }

  await client.send(
    new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: body.length,
      ServerSideEncryption: "AES256",
      Metadata: { ownerId },
    }),
  );

  return {
    key,
    uploadUrl: `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`,
  };
};

export const createProfileImageUpload = async (
  ownerId: string,
  contentType: string,
  sizeBytes: number,
) => {
  const extension = extensions[contentType];
  if (!extension) throw errors.badRequest("Unsupported image type");
  if (sizeBytes <= 0 || sizeBytes > 5 * 1024 * 1024) {
    throw errors.badRequest("Image must not exceed 5 MB");
  }
  if (true || !env.AWS_S3_BUCKET) {
    // DISABLED S3 FOR NOW
    const key = `driver-profiles/${ownerId}/${randomUUID()}.${extension}`;
    const baseUrl =
      env.NODE_ENV === "production"
        ? "https://tuk.technogigz.co.in"
        : `http://localhost:${env.PORT}`;
    return {
      key,
      uploadUrl: `${baseUrl}/images/${key}`,
      expiresInSeconds: 300,
    };
  }
  const key = `driver-profiles/${ownerId}/${randomUUID()}.${extension}`;
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
      ServerSideEncryption: "AES256",
      Metadata: { ownerId },
    }),
    { expiresIn: 300 },
  );
  return { key, uploadUrl, expiresInSeconds: 300 };
};

export const uploadDriverProfileImage = async (
  ownerId: string,
  contentType: string,
  body: Buffer,
) => {
  const extension = extensions[contentType];
  if (!extension || !["image/jpeg", "image/png"].includes(contentType)) {
    throw errors.badRequest("Profile image must be a JPEG or PNG file");
  }
  if (body.length <= 0 || body.length > 5 * 1024 * 1024) {
    throw errors.badRequest("Profile image must not exceed 5 MB");
  }

  const key = `driver-profiles/${ownerId}/${randomUUID()}.${extension}`;

  if (true || !env.AWS_S3_BUCKET) {
    // DISABLED S3 FOR NOW
    const fs = require("fs");
    const path = require("path");
    const filePath = path.join(process.cwd(), ".uploads", key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, body);

    const baseUrl =
      env.NODE_ENV === "production"
        ? "https://tuk.technogigz.co.in"
        : `http://localhost:${env.PORT}`;
    return {
      key,
      uploadUrl: `${baseUrl}/images/${key}`,
    };
  }

  await client.send(
    new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: body.length,
      ServerSideEncryption: "AES256",
      Metadata: { ownerId },
    }),
  );

  return {
    key,
    uploadUrl: `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`,
  };
};

export const uploadCustomerProfileImage = async (
  ownerId: string,
  contentType: string,
  body: Buffer,
) => {
  const extension = extensions[contentType];
  if (!extension || !["image/jpeg", "image/png"].includes(contentType)) {
    throw errors.badRequest("Profile image must be a JPEG or PNG file");
  }
  if (body.length <= 0 || body.length > 5 * 1024 * 1024) {
    throw errors.badRequest("Profile image must not exceed 5 MB");
  }
  const key = `customer-profiles/${ownerId}/${randomUUID()}.${extension}`;

  if (true || !env.AWS_S3_BUCKET) {
    // DISABLED S3 FOR NOW
    const fs = require("fs");
    const path = require("path");

    // Create local uploads directory if it doesn't exist
    const uploadDir = path.join(
      process.cwd(),
      ".uploads",
      "customer-profiles",
      ownerId,
    );
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const localFilePath = path.join(process.cwd(), ".uploads", key);
    fs.writeFileSync(localFilePath, body);

    const baseUrl =
      env.NODE_ENV === "production"
        ? "https://tuk.technogigz.co.in"
        : `http://localhost:${env.PORT}`;
    return {
      key,
      profileImageUrl: `${baseUrl}/images/${key}`,
    };
  }

  await client.send(
    new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: body.length,
      ServerSideEncryption: "AES256",
      Metadata: { ownerId },
    }),
  );

  return {
    key,
    profileImageUrl: `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`,
  };
};

export const uploadAdminProfileImage = async (
  ownerId: string,
  contentType: string,
  body: Buffer,
) => {
  const extension = extensions[contentType];
  if (!extension || !["image/jpeg", "image/png"].includes(contentType)) {
    throw errors.badRequest("Profile image must be a JPEG or PNG file");
  }
  if (body.length <= 0 || body.length > 5 * 1024 * 1024) {
    throw errors.badRequest("Profile image must not exceed 5 MB");
  }
  const key = `admin-profiles/${ownerId}/${randomUUID()}.${extension}`;

  if (true || !env.AWS_S3_BUCKET) {
    // DISABLED S3 FOR NOW
    const fs = require("fs");
    const path = require("path");

    // Create local uploads directory if it doesn't exist
    const uploadDir = path.join(
      process.cwd(),
      ".uploads",
      "admin-profiles",
      ownerId,
    );
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const localFilePath = path.join(process.cwd(), ".uploads", key);
    fs.writeFileSync(localFilePath, body);

    const baseUrl =
      env.NODE_ENV === "production"
        ? "https://tuk.technogigz.co.in"
        : `http://localhost:${env.PORT}`;
    return {
      key,
      profileImageUrl: `${baseUrl}/images/${key}`,
    };
  }

  await client.send(
    new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: body.length,
      ServerSideEncryption: "AES256",
      Metadata: { ownerId },
    }),
  );

  return {
    key,
    profileImageUrl: `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`,
  };
};

export const uploadSupportAttachment = async (
  ownerId: string,
  contentType: string,
  body: Buffer,
  filename?: string,
) => {
  if (
    !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
      contentType,
    )
  ) {
    throw errors.badRequest(
      "Support attachment must be a JPEG, PNG, WebP image or PDF file",
    );
  }
  if (body.length <= 0 || body.length > 5 * 1024 * 1024) {
    throw errors.badRequest("Support attachment must not exceed 5 MB");
  }
  const extension = extensions[contentType];
  const key = `support-attachments/${ownerId}/${randomUUID()}.${extension}`;

  if (true || !env.AWS_S3_BUCKET) {
    // DISABLED S3 FOR NOW
    const fs = require("fs");
    const path = require("path");
    const filePath = path.join(process.cwd(), ".uploads", key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, body);

    const baseUrl =
      env.NODE_ENV === "production"
        ? "https://tuk.technogigz.co.in"
        : `http://localhost:${env.PORT}`;
    return {
      key,
      name: filename || key.split("/").pop()!,
      url: `${baseUrl}/images/${key}`,
      contentType,
      sizeBytes: body.length,
    };
  }

  await client.send(
    new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: body.length,
      ServerSideEncryption: "AES256",
      Metadata: { ownerId },
    }),
  );

  return {
    key,
    name: filename || key.split("/").pop()!,
    url: `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`,
    contentType,
    sizeBytes: body.length,
  };
};

export const putReportFile = async (key: string, body: string) => {
  if (!env.AWS_S3_BUCKET) {
    const fs = require("fs");
    const path = require("path");
    const filePath = path.join(process.cwd(), ".uploads", key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, body);
    return;
  }

  await client.send(
    new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: "text/csv; charset=utf-8",
      ServerSideEncryption: "AES256",
    }),
  );
};

export const createPrivateDownloadUrl = async (
  key: string,
  expiresInSeconds = 300,
) => {
  if (!env.AWS_S3_BUCKET) {
    const baseUrl =
      env.NODE_ENV === "production"
        ? "https://tuk.technogigz.co.in"
        : `http://localhost:${env.PORT}`;
    return `${baseUrl}/images/${key}`;
  }

  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: env.AWS_S3_BUCKET, Key: key }),
    { expiresIn: expiresInSeconds },
  );
};
