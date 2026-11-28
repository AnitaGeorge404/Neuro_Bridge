import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import AnxietyPage from '@/pages/AnxietyPage';

/**
 * The agent's start_grounding_activity tool already picked and started a
 * real exercise before navigating here (see backend/services/agent_tools.py
 * _start_grounding_activity) — this page previously ignored location.state
 * entirely (confirmed via audit: no useLocation import at all), so the
 * exercise the agent "started" never actually became visible without the
 * user re-picking it manually. Discovered via the same audit that found the
 * focus-session chat-overlay bug.
 */

// jsdom has no IntersectionObserver — framer-motion's whileInView needs one.
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'anxiety-agent-user' } }) }));
vi.mock('@/hooks/useSensoryReducedMotion', () => ({ useSensoryReducedMotion: () => ({ reduced: true, gentle: true }) }));
vi.mock('@/hooks/useFeatureAdaptation', () => ({ useFeatureAdaptation: () => ({ configuration: null }) }));
vi.mock('@/context/ContextProvider', () => ({ useContextStateOptional: () => null }));
const execution = vi.hoisted(() => ({ executeSupportModule: vi.fn(async () => ({ ok: true, interventionId: 'anxiety-execution-1' })), completeSupportModule: vi.fn(), abandonSupportModule: vi.fn() }));
vi.mock('@/support/execution/executionApi', () => execution);
const repository = vi.hoisted(() => ({ listInterventionsByModule: vi.fn(async () => []), deleteIntervention: vi.fn() }));
vi.mock('@/support/persistence/role4Repository', () => ({ getRole4Repository: vi.fn(async () => repository) }));

function renderAnxietyPage(state) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/anxiety', state }]}>
      <AnxietyPage />
    </MemoryRouter>,
  );
}

describe('AnxietyPage — auto-opening the exercise the agent already started', () => {
  afterEach(() => cleanup());

  it('keeps direct cards usable without consent and creates no durable execution', async () => {
    renderAnxietyPage();
    fireEvent.click(screen.getAllByText('Start')[0]);
    expect(screen.getByRole('dialog', { name: 'Intervention' })).toBeTruthy();
    expect(execution.executeSupportModule).not.toHaveBeenCalled();
  });

  it('creates one consented execution with a per-execution identity', async () => {
    renderAnxietyPage();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getAllByText('Start')[0]);
    await waitFor(() => expect(execution.executeSupportModule).toHaveBeenCalledTimes(1));
    expect(execution.executeSupportModule.mock.calls[0][0].metadata).toMatchObject({ telemetryConsent: true });
    expect(execution.executeSupportModule.mock.calls[0][0].metadata.idempotencyKey).toMatch(/^anxiety:/);
  });

  it('opens the intervention modal for a Box Breathing session started by the agent', () => {
    renderAnxietyPage({ exercise_type: 'Box Breathing' });
    expect(screen.getByRole('dialog', { name: 'Intervention' })).toBeTruthy();
  });

  it('opens the intervention modal for a 5-4-3-2-1 Senses session started by the agent', () => {
    renderAnxietyPage({ exercise_type: '5-4-3-2-1 Senses' });
    expect(screen.getByRole('dialog', { name: 'Intervention' })).toBeTruthy();
  });

  it('does not open any modal when the user just navigated here manually', () => {
    renderAnxietyPage(undefined);
    expect(screen.queryByRole('dialog', { name: 'Intervention' })).toBeNull();
  });

  it('does not open any modal for an unrecognized exercise_type', () => {
    renderAnxietyPage({ exercise_type: 'Something Unexpected' });
    expect(screen.queryByRole('dialog', { name: 'Intervention' })).toBeNull();
  });
});
