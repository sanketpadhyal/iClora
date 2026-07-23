import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { apiFetch } from './api/backendapi';

jest.mock('./api/backendapi', () => ({
  apiFetch: jest.fn(),
}));

beforeEach(() => {
  apiFetch.mockResolvedValue({
    ok: false,
    json: () => Promise.resolve({}),
  });
});

test('renders the iClora install experience', async () => {
  render(
    <MemoryRouter
      initialEntries={['/home']}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <App />
    </MemoryRouter>,
  );

  expect(screen.getByRole('navigation', { name: /primary navigation/i })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: /iclora/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
});
