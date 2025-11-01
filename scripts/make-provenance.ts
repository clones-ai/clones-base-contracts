import fs from "fs";

interface Provenance {
  datasetName: string;
  creator: string; // EOA
  contributors: { address: string; shareBps: number }[];
  quality: { score: number; validatedWorkflows: number; reportCID: string };
  createdAt: string;
}

const p: Provenance = {
  datasetName: "E-commerce Customer Service",
  creator: "0xCreator...",
  contributors: [{ address: "0xContributor...", shareBps: 10000 }],
  quality: { score: 87, validatedWorkflows: 1247, reportCID: "bafy...quality" },
  createdAt: new Date().toISOString(),
};

fs.writeFileSync("provenance.json", JSON.stringify(p, null, 2));
console.log("provenance.json written");
