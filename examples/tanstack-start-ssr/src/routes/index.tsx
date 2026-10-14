import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';

// Runs on the server only: the timestamp changes on each reload.
const getRenderedAt = createServerFn({ method: 'GET' }).handler(() => new Date().toISOString());

export const Route = createFileRoute('/')({
  loader: () => getRenderedAt(),
  component: Home,
});

function Home() {
  const renderedAt = Route.useLoaderData();
  return (
    <>
      <h1>TanStack Start on Lambda Web Functions</h1>
      <p>
        Rendered on the server at <time>{renderedAt}</time>.
      </p>
    </>
  );
}
