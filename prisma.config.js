module.exports = {
  schema: 'schema.prisma', // Or 'prisma/schema.prisma' if your file is inside a prisma folder
  datasource: {
    url: 'file:./dev.db',
  },
  migrations: {
    seed: 'node ./prisma/seed.js',
  },
};