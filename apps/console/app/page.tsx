import { redirect } from 'next/navigation';

// Every console surface is authenticated (ADR-012). Until the S02 auth module exists,
// the root simply sends staff to the login placeholder.
export default function Home() {
  redirect('/login');
}
