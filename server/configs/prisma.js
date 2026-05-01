import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Pool } from "@neondatabase/serverless";
import ws from "ws";

const neonConfig = { webSocketConstructor: ws, poolQueryViaFetch: true };

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({ connectionString, ...neonConfig });
const adapter = new PrismaNeon(pool);
const prisma = global.prisma || new PrismaClient({ adapter });

if (process.env.NODE_ENV === "development") global.prisma = prisma;

export default prisma;
