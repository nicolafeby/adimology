import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { isSameOrigin } from '../lib/request-security';

test('accepts the public origin forwarded by a reverse proxy', () => {
  const request = new NextRequest('http://127.0.0.1:3000/api/auth/set-password', {
    headers: {
      origin: 'https://market.nicolaboard.my.id',
      'x-forwarded-host': 'market.nicolaboard.my.id',
      'x-forwarded-proto': 'https',
    },
  });

  assert.equal(isSameOrigin(request), true);
});

test('rejects a foreign browser origin', () => {
  const request = new NextRequest('http://127.0.0.1:3000/api/auth/set-password', {
    headers: {
      origin: 'https://attacker.example',
      'x-forwarded-host': 'market.nicolaboard.my.id',
      'x-forwarded-proto': 'https',
    },
  });

  assert.equal(isSameOrigin(request), false);
});

test('accepts direct same-origin requests', () => {
  const request = new NextRequest('http://localhost:3000/api/auth/set-password', {
    headers: { origin: 'http://localhost:3000' },
  });

  assert.equal(isSameOrigin(request), true);
});
