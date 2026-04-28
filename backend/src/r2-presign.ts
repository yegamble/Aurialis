/**
 * R2 SigV4 presigning for direct-to-R2 uploads.
 *
 * Two helpers:
 *   presignUploadPart — signs a PUT URL for one part of a multipart upload
 *   presignGet        — signs a GET URL for the FastAPI container to fetch
 *
 * BOTH helpers hard-code the bucket name from `env.UPLOADS_BUCKET_NAME`.
 * Neither accepts a bucket parameter. This is the SSRF mitigation: even if
 * an attacker controls the `key`, they can't redirect the signed URL to a
 * different bucket.
 */

import { AwsClient } from "aws4fetch";

type PresignEnv = Pick<
  Env,
  | "UPLOADS_BUCKET_NAME"
  | "R2_ACCESS_KEY_ID"
  | "R2_SECRET_ACCESS_KEY"
  | "R2_ACCOUNT_ID"
>;

function r2Endpoint(env: PresignEnv): string {
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
}

function makeClient(env: PresignEnv): AwsClient {
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
}

export async function presignUploadPart(
  env: PresignEnv,
  key: string,
  uploadId: string,
  partNumber: number,
  expirySec: number
): Promise<string> {
  const client = makeClient(env);
  const baseUrl =
    `${r2Endpoint(env)}/${env.UPLOADS_BUCKET_NAME}/${encodeURIComponent(key)}` +
    `?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}` +
    `&X-Amz-Expires=${expirySec}`;

  const signed = await client.sign(
    new Request(baseUrl, { method: "PUT" }),
    { aws: { signQuery: true } }
  );
  return signed.url;
}

export async function presignGet(
  env: PresignEnv,
  key: string,
  expirySec: number
): Promise<string> {
  const client = makeClient(env);
  const baseUrl =
    `${r2Endpoint(env)}/${env.UPLOADS_BUCKET_NAME}/${encodeURIComponent(key)}` +
    `?X-Amz-Expires=${expirySec}`;

  const signed = await client.sign(
    new Request(baseUrl, { method: "GET" }),
    { aws: { signQuery: true } }
  );
  return signed.url;
}
