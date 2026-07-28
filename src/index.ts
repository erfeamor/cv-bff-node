import 'dotenv/config';
import { createApp } from './app';

const PORT = process.env.PORT || 3000;

createApp().listen(PORT, () => {
  console.log(`cv-bff-node listening on :${PORT}`);
});
