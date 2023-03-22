import { writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient()

const metrics = await prisma.$metrics.json()

writeFileSync("./metricsLogs/" + new Date().toDateString() + "-METRICS.json", JSON.stringify(metrics));