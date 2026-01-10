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

export async function readRegistry(networkName: string, subdirectory?: string) {
    const basePath = subdirectory
        ? path.resolve(process.cwd(), "deployments", subdirectory)
        : path.resolve(process.cwd(), "deployments");
    const p = path.resolve(basePath, `${networkName}.json`);
    try {
        const raw = await fs.readFile(p, "utf8");
        return JSON.parse(raw);
    } catch {
        return { contracts: {} as Record<string, { address: string; args?: any[]; txHash?: string; impl?: string }> };
    }
}

export async function writeRegistry(networkName: string, data: any, subdirectory?: string, includeTimestamp: boolean = false) {
    const dir = subdirectory
        ? path.resolve(process.cwd(), "deployments", subdirectory)
        : path.resolve(process.cwd(), "deployments");
    await fs.mkdir(dir, { recursive: true });

    let filename = networkName;
    if (includeTimestamp) {
        const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
        filename = `${networkName}-${timestamp}`;
    }

    const p = path.resolve(dir, `${filename}.json`);
    await fs.writeFile(p, JSON.stringify(data, null, 2) + "\n", "utf8");

    // Also write a "latest" version for easy reference
    if (includeTimestamp) {
        const latestPath = path.resolve(dir, `${networkName}-latest.json`);
        await fs.writeFile(latestPath, JSON.stringify(data, null, 2) + "\n", "utf8");
    }
}
