import fs from "fs";
import path from "path";

// Stub: use Pinata, web3.storage, or your gateway SDK.
export async function pinJson(obj: any): Promise<string> {
  // TODO: replace with real pin; here we just write to disk and pretend a CID
  const p = path.join(process.cwd(), "tmp-ipfs", `${obj.slug || obj.id}.json`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  // return placeholder CID (replace in production)
  return `bafy-${obj.id}`;
}
