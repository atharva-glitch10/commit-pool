import { test, expect } from '@playwright/test'
import { verifyMessage, recoverTransactionAddress, parseTransaction } from 'viem'

test('virtual PRF passkey creates an account and recovers an encrypted journal after reload', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } })
  await page.route('https://testnet-rpc.monad.xyz/**', async route => {
    const payload = route.request().postDataJSON()
    const response = (r: { id: number; method: string }) => ({ jsonrpc: '2.0', id: r.id, result: r.method === 'eth_chainId' ? '0x279f' : r.method === 'eth_getLogs' ? [] : r.method === 'eth_call' ? `0x${'0'.repeat(64)}` : '0x0' })
    await route.fulfill({ json: Array.isArray(payload) ? payload.map(response) : response(payload) })
  })
  await page.route('**/api/journal', route => route.fulfill({ json: { configured: false } }))
  await page.goto('/#/start')
  await page.getByRole('button', { name: 'Create a passkey account', exact: true }).click()
  await expect(page.getByText('Grab free test MON', { exact: false })).toBeVisible()
  const metadata = await page.evaluate(() => JSON.parse(localStorage.getItem('commitpool.passkey.v1')!))
  expect(metadata.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
  expect(Object.keys(metadata).sort()).toEqual(['address', 'credentialId', 'version'])
  await page.goto('/#/journal?pool=12')
  await page.getByRole('button', { name: 'Unlock private journal' }).click()
  await page.getByRole('textbox', { name: 'Why did you commit? How did today go?' }).fill('Private motivation: show up for my friends 🌱')
  await page.getByRole('button', { name: 'Save encrypted reflection' }).click()
  await expect(page.getByText('Encrypted entry saved on this device.')).toBeVisible()
  const ciphertext = await page.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith('commitpool.journal.v1:'))?.[1])
  expect(ciphertext).toBeTruthy(); expect(ciphertext).not.toContain('motivation'); expect(ciphertext).not.toContain('poolId')
  await page.getByRole('button', { name: 'Lock journal', exact: true }).click()
  await expect(page.getByText('Private motivation: show up for my friends 🌱')).toHaveCount(0)
  await page.reload()
  await page.getByRole('link', { name: 'Use a passkey', exact: true }).click()
  await page.getByRole('button', { name: 'Unlock my passkey', exact: true }).click()
  await expect(page.getByText('Grab free test MON', { exact: false })).toBeVisible()
  await page.getByRole('link', { name: 'Continue without funds' }).click()
  await page.getByRole('button', { name: 'Unlock private journal' }).click()
  await expect(page.getByText('Private motivation: show up for my friends 🌱')).toBeVisible()
  const recovered = await page.evaluate(() => JSON.parse(localStorage.getItem('commitpool.passkey.v1')!).address)
  expect(recovered).toBe(metadata.address)
  await page.screenshot({ path: 'tests/artifacts/journal-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('textbox', { name: 'Edit your reflection' }).fill('Updated private reflection')
  await page.getByRole('button', { name: 'Save encrypted changes' }).click()
  await expect(page.getByText('Updated private reflection')).toBeVisible()
  page.on('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('Updated private reflection')).toHaveCount(0)
})

test('journal explains passkey requirement and has no horizontal overflow on a phone', async ({ page }) => {
  await page.goto('/#/journal')
  await expect(page.getByRole('heading', { name: 'Private journal' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Use a passkey', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('cloud journal requests use the connected Mera signer and send only ciphertext', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } })
  await page.route('https://testnet-rpc.monad.xyz/**', async route => {
    const p = route.request().postDataJSON(), reply = (r: { id: number; method: string }) => ({ jsonrpc: '2.0', id: r.id, result: r.method === 'eth_getLogs' ? [] : r.method === 'eth_call' ? `0x${'0'.repeat(64)}` : '0x0' })
    await route.fulfill({ json: Array.isArray(p) ? p.map(reply) : reply(p) })
  })
  const entries = new Map(), messages = new Map()
  let signedRequests = 0
  await page.route('**/api/journal', async route => {
    const body = route.request().postDataJSON()
    if (body.action === 'status') { await route.fulfill({ json: { configured: true } }); return }
    if (body.action === 'challenge') {
      const nonce = `${messages.size}`, message = `CommitPool test journal authorization: ${body.member}, ${body.operation.action}, ${nonce}`
      messages.set(nonce, message); await route.fulfill({ json: { nonce, message } }); return
    }
    const valid = await verifyMessage({ address: body.member, message: messages.get(body.nonce), signature: body.signature })
    expect(valid).toBe(true); signedRequests++
    expect(JSON.stringify(body)).not.toContain('My cloud reflection')
    if (body.operation.action === 'save') { entries.set(body.operation.entry.id, body.operation.entry); await route.fulfill({ json: { saved: true } }) }
    else if (body.operation.action === 'delete') { entries.delete(body.operation.id); await route.fulfill({ json: { deleted: true } }) }
    else await route.fulfill({ json: { entries: [...entries.values()] } })
  })
  page.on('dialog', dialog => dialog.accept())
  await page.goto('/#/start')
  await page.getByRole('button', { name: 'Create a passkey account', exact: true }).click()
  await expect(page.getByText('Grab free test MON', { exact: false })).toBeVisible()
  await page.goto('/#/journal')
  await page.getByRole('checkbox', { name: 'Cloud journal' }).check()
  await page.getByRole('button', { name: 'Unlock private journal' }).click()
  await page.getByRole('textbox', { name: 'Why did you commit? How did today go?' }).fill('My cloud reflection')
  await page.getByRole('button', { name: 'Save encrypted reflection' }).click()
  await expect(page.getByText('Encrypted entry synced.', { exact: false })).toBeVisible()
  expect(entries.size).toBe(1)
  await page.getByRole('button', { name: 'Lock journal', exact: true }).click()
  // Simulate a compatible device without the local ciphertext cache.
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('commitpool.journal.v1:')) localStorage.removeItem(k) })
  await page.getByRole('button', { name: 'Unlock private journal' }).click()
  await expect(page.getByText('My cloud reflection', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('My cloud reflection', { exact: true })).toHaveCount(0)
  expect(entries.size).toBe(0); expect(signedRequests).toBe(4)
})

test('Mera signs a correctly addressed Monad transaction through wagmi', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } })
  let serialized: `0x${string}` | undefined
  const hash = `0x${'f'.repeat(64)}`
  await page.route('https://testnet-rpc.monad.xyz/**', async route => {
    const payload = route.request().postDataJSON()
    const respond = (r: { id: number; method: string; params?: string[] }) => {
      let result: unknown = '0x0'
      if (r.method === 'eth_chainId') result = '0x279f'
      if (r.method === 'eth_getBalance') result = '0xde0b6b3a7640000'
      if (r.method === 'eth_getLogs') result = []
      if (r.method === 'eth_call') result = `0x${'0'.repeat(64)}`
      if (r.method === 'eth_estimateGas') result = '0x493e0'
      if (r.method === 'eth_gasPrice' || r.method === 'eth_maxPriorityFeePerGas') result = '0x3b9aca00'
      if (r.method === 'eth_getBlockByNumber') result = { number: '0x1', timestamp: '0x6b49d200', baseFeePerGas: '0x3b9aca00', gasLimit: '0x1c9c380', gasUsed: '0x0', hash, transactions: [], parentHash: hash, difficulty: '0x0', totalDifficulty: '0x0', extraData: '0x', nonce: '0x0000000000000000', miner: `0x${'0'.repeat(40)}`, size: '0x1' }
      if (r.method === 'eth_sendRawTransaction') { serialized = r.params![0] as `0x${string}`; result = hash }
      if (r.method === 'eth_getTransactionReceipt') result = { transactionHash: hash, transactionIndex: '0x0', blockHash: hash, blockNumber: '0x1', from: `0x${'0'.repeat(40)}`, to: '0x59747B1A995EF0Cb01CA6A97CE0aaeA38b2474F4', cumulativeGasUsed: '0x493e0', gasUsed: '0x493e0', contractAddress: null, logs: [], logsBloom: `0x${'0'.repeat(512)}`, status: '0x1', effectiveGasPrice: '0x3b9aca00', type: '0x2' }
      return { jsonrpc: '2.0', id: r.id, result }
    }
    await route.fulfill({ json: Array.isArray(payload) ? payload.map(respond) : respond(payload) })
  })
  page.on('dialog', dialog => dialog.accept())
  await page.goto('/#/start')
  await page.getByRole('button', { name: 'Create a passkey account', exact: true }).click()
  await expect.poll(() => page.evaluate(() => !!localStorage.getItem('commitpool.passkey.v1'))).toBe(true)
  const owner = await page.evaluate(() => JSON.parse(localStorage.getItem('commitpool.passkey.v1')!).address)
  await page.goto('/#/new')
  await page.getByRole('button', { name: 'Sign the pledge and lock 0.1 MON', exact: true }).click()
  await expect.poll(() => !!serialized).toBe(true)
  const transaction = parseTransaction(serialized!)
  expect(transaction.chainId).toBe(10143)
  expect(transaction.to?.toLowerCase()).toBe('0x59747b1a995ef0cb01ca6a97ce0aaea38b2474f4')
  expect(transaction.value).toBe(100000000000000000n)
  expect((await recoverTransactionAddress({ serializedTransaction: serialized! })).toLowerCase()).toBe(owner.toLowerCase())
})
