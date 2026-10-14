// Seeds ONLY structural data: the standard category tree. No medicines, barcodes or prices are
// invented - products must be added from verified pack/invoice data (admin panel or Excel import).
// Usage: npm run seed:base   (safe to run more than once)
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const Category = require('../models/Category');

const TREE = [
  ['Medicines', ['Tablets', 'Capsules', 'Syrups', 'Injections', 'IV Fluids', 'Drops', 'Creams & Ointments', 'Inhalers']],
  ['Prescription Medicines', []],
  ['OTC Medicines', ['Pain Relief', 'Cold & Cough', 'Digestive Care', 'Allergy']],
  ['Generic Medicines', []],
  ['Branded Medicines', []],
  ['Surgical Products', ['Syringes & Needles', 'Dressings', 'Gloves & Masks', 'Bandages']],
  ['First Aid', []],
  ['Dermatology', []],
  ['Personal Care', ['Oral Care', 'Skin Care', 'Hair Care', 'Feminine Care']],
  ['Nutrition & Supplements', ['Vitamins', 'Protein', 'Health Drinks']],
  ['Baby Care', ['Diapers', 'Baby Skin Care', 'Baby Food']],
  ['Medical Devices', ['BP Monitors', 'Glucometers & Strips', 'Thermometers', 'Nebulizers', 'Pulse Oximeters']],
];

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  await connectDB();
  let created = 0;
  for (const [i, [name, children]] of TREE.entries()) {
    const parent = await Category.findOneAndUpdate({ slug: slugify(name) }, { $setOnInsert: { name, slug: slugify(name), sortOrder: i, active: true } }, { upsert: true, new: true, includeResultMetadata: true });
    if (!parent.lastErrorObject?.updatedExisting) created += 1;
    for (const [j, child] of children.entries()) {
      const slug = `${slugify(name)}-${slugify(child)}`;
      const r = await Category.findOneAndUpdate({ slug }, { $setOnInsert: { name: child, slug, parent: parent.value._id, sortOrder: j, active: true } }, { upsert: true, new: true, includeResultMetadata: true });
      if (!r.lastErrorObject?.updatedExisting) created += 1;
    }
  }
  console.log(`Category tree ready (${created} new categories).`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => mongoose.disconnect());
