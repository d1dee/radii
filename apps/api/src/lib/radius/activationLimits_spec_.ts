import { describe, expect, test } from 'bun:test';
import { adminSettingsSchema } from '@radii/shared';
import {
    activationIsAvailable,
    calculatePppoeActivationWindow,
} from './activationLimits';

describe('PPPoE activation scheduling', () => {
    const now = new Date('2026-11-27T12:00:00.000Z');

    test('uses sequential renewals by default for existing settings', () => {
        const settings = adminSettingsSchema.parse({
            pppoe: { showPasswordsInPortal: false },
        });

        expect(settings.pppoe.renewalActivationMode).toBe(
            'after_previous_expires',
        );
    });

    test('places a sequential renewal behind the queue tail', () => {
        const tail = new Date('2026-11-28T12:00:00.000Z');
        const window = calculatePppoeActivationWindow({
            mode: 'after_previous_expires',
            now,
            queueTailExpiresAt: tail,
            durationMinutes: 60,
        });

        expect(window.activatedAt).toEqual(tail);
        expect(window.expireAt).toEqual(
            new Date('2026-11-28T13:00:00.000Z'),
        );
    });

    test('starts a sequential renewal now when the queue is empty or expired', () => {
        const window = calculatePppoeActivationWindow({
            mode: 'after_previous_expires',
            now,
            queueTailExpiresAt: new Date('2026-11-26T12:00:00.000Z'),
            durationMinutes: 60,
        });

        expect(window.activatedAt).toEqual(now);
        expect(window.expireAt).toEqual(
            new Date('2026-11-27T13:00:00.000Z'),
        );
    });

    test('starts an immediate renewal now despite an existing queue', () => {
        const window = calculatePppoeActivationWindow({
            mode: 'immediate',
            now,
            queueTailExpiresAt: new Date('2026-11-28T12:00:00.000Z'),
            durationMinutes: 60,
        });

        expect(window.activatedAt).toEqual(now);
        expect(window.expireAt).toEqual(
            new Date('2026-11-27T13:00:00.000Z'),
        );
    });

    test('does not treat a queued activation as currently available', () => {
        expect(
            activationIsAvailable({
                activatedAt: new Date('2026-11-28T12:00:00.000Z'),
                deactivatedAt: null,
                expireAt: new Date('2026-11-28T13:00:00.000Z'),
                remainingSeconds: 3600,
                now,
            }),
        ).toBe(false);
    });
});
