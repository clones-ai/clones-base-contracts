import fs from "fs";
import path from "path";
import { create as createIpfsClient } from "ipfs-http-client";

// Assumes local IPFS daemon or a hosted endpoint with auth
const client = createIpfsClient({ url: process.env.IPFS_API! });

async function main() {
  const filePath = process.argv[2];
  if (!filePath) throw new Error("Usage: ts-node scripts/ipfs-pin.ts <path>");
  const content = fs.readFileSync(path.resolve(filePath));
  const { cid } = await client.add(content, { pin: true });
  console.log("CID:", cid.toString());
}
main().catch(console.error);
