require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const adminPassword = await bcrypt.hash('admin123', 12);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@coldoutreach.nl' },
    update: {},
    create: {
      name: 'Admin',
      email: 'admin@coldoutreach.nl',
      password: adminPassword,
      role: 'ADMIN'
    }
  });
  console.log('Admin gebruiker aangemaakt:', admin.email);

  const packages = [
    { name: 'Snelle start', oneTimePrice: 1350, monthlyPrice: 20 },
    { name: 'Stevige start', oneTimePrice: 2350, monthlyPrice: 20 },
    { name: 'Start met een voorsprong', oneTimePrice: 3750, monthlyPrice: 20 }
  ];

  for (const pkg of packages) {
    await prisma.package.upsert({
      where: { id: pkg.name.toLowerCase().replace(/\s+/g, '-') },
      update: {},
      create: pkg
    });
  }
  console.log('Pakketten aangemaakt');

  const upsells = [
    { name: 'SEO-track', price: 125, billingType: 'MONTHLY' },
    { name: 'Bedrijfsfotografie', price: 550, billingType: 'ONE_TIME' }
  ];

  for (const upsell of upsells) {
    await prisma.upsell.upsert({
      where: { id: upsell.name.toLowerCase().replace(/\s+/g, '-') },
      update: {},
      create: upsell
    });
  }
  console.log('Upsells aangemaakt');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
