// Interactive, one-time Super Admin creation from the terminal.
// Usage (inside backend folder):  npm run init:admin
// The password is typed by the owner and never stored in code or .env.
const readline = require('readline');
const { connectDB } = require('../config/db');
const User = require('../models/User');
const mongoose = require('mongoose');

const DEFAULT_PHONE = '9264289295';
const DEFAULT_EMAIL = 'niteshkumar3850022@gmail.com';

function ask(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => { rl.close(); resolve(a.trim()); });
  });
}

/** Read a password without echoing it. */
function askHidden(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = true;
    // eslint-disable-next-line no-underscore-dangle
    rl._writeToOutput = (s) => {
      if (rl.stdoutMuted && !s.includes(q)) rl.output.write('*');
      else rl.output.write(s);
    };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

async function main() {
  await connectDB();
  if (await User.exists({ role: 'super_admin' })) {
    console.log('A Super Admin already exists. Use the admin panel to manage administrators.');
    return;
  }
  const name = (await ask('Owner name [Nitesh Kumar]: ')) || 'Nitesh Kumar';
  const phone = (await ask(`Mobile [${DEFAULT_PHONE}]: `)) || DEFAULT_PHONE;
  const email = (await ask(`Email [${DEFAULT_EMAIL}]: `)) || DEFAULT_EMAIL;
  let password;
  for (;;) {
    password = await askHidden('Choose a strong password (min 8 chars, letters + numbers): ');
    const again = await askHidden('Confirm password: ');
    if (password !== again) { console.log('Passwords do not match.'); continue; }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) { console.log('Password too weak.'); continue; }
    break;
  }
  if (!/^[6-9]\d{9}$/.test(phone)) throw new Error('Invalid mobile number');
  const user = new User({ name, phone, email, role: 'super_admin', allStores: true, phoneVerified: true });
  await user.setPassword(password);
  await user.save();
  console.log(`\nSuper Admin created for ${name} (${phone}). Log in at /login with your mobile number or email.`);
}

main()
  .catch((e) => { console.error('Failed:', e.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
