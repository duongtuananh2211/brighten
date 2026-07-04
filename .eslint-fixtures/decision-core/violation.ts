import fs from "node:fs";

export const invalidClockRead = Date.now();
export const invalidRandomRead = Math.random();
export const invalidDiskRead = fs.readFileSync("never-run", "utf8");
