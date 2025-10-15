import { promises as fs } from "fs";
import path from "path";

export async function parseArgs(input?: string): Promise<any[]> {
    if (!input) return [];
    input = input.trim();
    // If it's a path to a JSON file
    if (input.endsWith(".json") || input.endsWith(".JSON")) {
        const p = path.resolve(process.cwd(), input);
        const raw = await fs.readFile(p, "utf8");
        return JSON.parse(raw);
    }
    // Otherwise, expect a JSON array as string
    return JSON.parse(input);
}

export async function loadArgsFileOrEmpty(filePath?: string): Promise<any[]> {
    if (!filePath) return [];
    const raw = await fs.readFile(path.resolve(process.cwd(), filePath), "utf8");
    return JSON.parse(raw);
}

export async function readRegistry(networkName: string) {
    const p = path.resolve(process.cwd(), "deployments", `${networkName}.json`);
    try {
        const raw = await fs.readFile(p, "utf8");
        return JSON.parse(raw);
    } catch {
        return { contracts: {} as Record<string, { address: string; args?: any[]; txHash?: string; impl?: string }> };
    }
}

export async function writeRegistry(networkName: string, data: any) {
    const dir = path.resolve(process.cwd(), "deployments");
    await fs.mkdir(dir, { recursive: true });
    const p = path.resolve(dir, `${networkName}.json`);
    await fs.writeFile(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}
