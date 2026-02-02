import "dotenv/config";
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client'
import fs from 'fs';

const connectionString = `${process.env.DATABASE_URL}`

const adapter = new PrismaPg({ connectionString,
ssl: {
    // ca: fs.readFileSync("./global-bundle.pem", "utf8"),
    rejectUnauthorized: false,
  },
 })
const prisma = new PrismaClient({ adapter,
    
 })

export { prisma, PrismaClient }