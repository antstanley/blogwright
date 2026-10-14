// Rendered on every request: the timestamp changes on each reload.
export const dynamic = 'force-dynamic';

export default function Home() {
  const renderedAt = new Date().toISOString();
  return (
    <>
      <h1>Next.js on Lambda Web Functions</h1>
      <p>
        Rendered on the server at <time>{renderedAt}</time>.
      </p>
    </>
  );
}
