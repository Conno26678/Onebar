require('dotenv').config();

const port = process.env.PORT || 3000;

module.exports = {
  port,
  AUTH_URL: process.env.AUTH_URL || 'https://formbeta.yorktechapps.com/',
  THIS_URL: process.env.THIS_URL || `http://localhost:${port}/`,
  FORMBAR_ADDRESS: process.env.FORMBAR_ADDRESS || 'formbeta.yorktechapps.com',
  SESSION_SECRET: 'Ich bin dein Gummibär, ich bin dein Gummibär'
};
