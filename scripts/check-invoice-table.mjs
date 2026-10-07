import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

const rows = await p.$queryRawUnsafe(`select count(*)::int as n from "Invoice"`);
console.log("INVOICE_TABLE_OK", JSON.stringify(rows));
await p.$disconnect();
