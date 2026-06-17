const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const { PrismaClient, UserRole } = require("@prisma/client");

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const username = "admin";
  const password = process.env.ADMIN_INITIAL_PASSWORD || "admin123456";
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { username },
    update: {
      passwordHash,
      role: UserRole.admin,
      mustChangePassword: false
    },
    create: {
      username,
      passwordHash,
      role: UserRole.admin,
      mustChangePassword: false
    }
  });

  console.log("Seed completed. Admin username: admin");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
