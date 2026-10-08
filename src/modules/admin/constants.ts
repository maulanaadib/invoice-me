// src/modules/admin/constants.ts
// Admin panel constants in a CLIENT-SAFE module (feature 07 lesson: a constant
// exported from a "use client" component becomes a client reference in a server
// page → NaN → Prisma "Argument take is missing" and the table never renders).
// Every admin page and client table imports page sizes from HERE.

/** Rows per page of the /admin/users list (feature 01 page, feature 09 home). */
export const USERS_PAGE_SIZE = 10;
