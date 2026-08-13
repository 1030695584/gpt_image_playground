import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('preset config policy', () => {
  it('exposes every current preset profile in preset-only mode', async () => {
    vi.stubEnv('VITE_SHOW_PRESET_CONFIG_ONLY', 'true')
    const { createDefaultFalProfile, createDefaultOpenAIProfile } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    policy.setPresetConfig({
      customProviders: [],
      profiles: [
        createDefaultOpenAIProfile({ id: 'preset-a', isDefault: true }),
        createDefaultFalProfile({ id: 'preset-b' }),
      ],
    })

    expect(policy.isPresetConfigOnlyEnabled()).toBe(true)
    expect(policy.getPresetProfileIds()).toEqual(new Set(['preset-a', 'preset-b']))
    expect(policy.getDefaultPresetProfileId()).toBe('preset-a')
  })

  it('accepts the legacy preset-only environment variable', async () => {
    vi.stubEnv('VITE_SHOW_DEFAULT_CONFIG_ONLY', 'true')
    const { createDefaultOpenAIProfile } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    policy.setPresetConfig({ customProviders: [], profiles: [createDefaultOpenAIProfile()] })

    expect(policy.isPresetConfigOnlyEnabled()).toBe(true)
  })

  it('restores locked preset parameters without removing user profiles', async () => {
    vi.stubEnv('VITE_LOCK_PRESET_CONFIG_PARAMS', 'true')
    const { createDefaultFalProfile, createDefaultOpenAIProfile, normalizeSettings } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    const source = createDefaultOpenAIProfile({
      id: 'preset-a',
      isDefault: true,
      baseUrl: 'https://preset.example.com/v1',
      model: 'preset-model',
    })
    const user = createDefaultFalProfile({ id: 'user-profile', model: 'user-model' })
    policy.setPresetConfig({ customProviders: [], profiles: [source] })

    const enforced = policy.enforcePresetConfigPolicy(normalizeSettings({
      profiles: [{ ...source, baseUrl: 'https://local.example.com/v1', model: 'local-model' }, user],
      activeProfileId: user.id,
    }))

    expect(enforced.profiles[0]).toMatchObject({
      id: source.id,
      baseUrl: 'https://preset.example.com/v1',
      model: 'preset-model',
    })
    expect(enforced.profiles[1]).toMatchObject({ id: user.id, model: 'user-model' })
    expect(enforced.activeProfileId).toBe(user.id)
  })

  it('allows removed presets to stay deleted by default', async () => {
    const { createDefaultFalProfile, createDefaultOpenAIProfile, normalizeSettings } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    const presetA = createDefaultOpenAIProfile({ id: 'preset-a', isDefault: true })
    const presetB = createDefaultFalProfile({ id: 'preset-b' })
    const user = createDefaultOpenAIProfile({ id: 'user-profile' })
    policy.setPresetConfig({ customProviders: [], profiles: [presetA, presetB] })

    const enforced = policy.enforcePresetConfigPolicy(normalizeSettings({
      profiles: [presetA, user],
      activeProfileId: user.id,
    }))

    expect(policy.isPresetProfile(presetA.id)).toBe(true)
    expect(policy.isPresetProfile(presetB.id)).toBe(true)
    expect(enforced.profiles.map((profile) => profile.id)).toEqual(['preset-a', 'user-profile'])
  })

  it('restores removed presets when deletion is prevented', async () => {
    vi.stubEnv('VITE_PREVENT_PRESET_CONFIG_DELETION', 'true')
    const { createDefaultFalProfile, createDefaultOpenAIProfile, normalizeSettings } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    const presetA = createDefaultOpenAIProfile({ id: 'preset-a', isDefault: true })
    const presetB = createDefaultFalProfile({ id: 'preset-b' })
    const user = createDefaultOpenAIProfile({ id: 'user-profile' })
    policy.setPresetConfig({ customProviders: [], profiles: [presetA, presetB] })

    const enforced = policy.enforcePresetConfigPolicy(normalizeSettings({
      profiles: [presetA, user],
      activeProfileId: user.id,
    }))

    expect(policy.isPresetConfigDeletionPrevented()).toBe(true)
    expect(enforced.profiles.map((profile) => profile.id)).toEqual(['preset-a', 'user-profile', 'preset-b'])
  })

  it('locks preset parameters without restoring their deployment order', async () => {
    vi.stubEnv('VITE_LOCK_PRESET_CONFIG_PARAMS', 'true')
    const { createDefaultFalProfile, createDefaultOpenAIProfile, normalizeSettings } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    const presetA = createDefaultOpenAIProfile({ id: 'preset-a', isDefault: true, model: 'preset-a-model' })
    const presetB = createDefaultFalProfile({ id: 'preset-b', model: 'preset-b-model' })
    const user = createDefaultOpenAIProfile({ id: 'user-profile' })
    policy.setPresetConfig({ customProviders: [], profiles: [presetA, presetB] })

    const enforced = policy.enforcePresetConfigPolicy(normalizeSettings({
      profiles: [presetA, user, { ...presetB, model: 'local-model' }],
      activeProfileId: user.id,
    }))

    expect(enforced.profiles.map((profile) => profile.id)).toEqual(['preset-a', 'user-profile', 'preset-b'])
    expect(enforced.profiles[2].model).toBe('preset-b-model')
  })

  it('uses the default OpenAI-compatible preset URL but not the fal.ai URL as the empty-field fallback', async () => {
    const { createDefaultFalProfile, createDefaultOpenAIProfile } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    policy.setPresetConfig({
      customProviders: [],
      profiles: [createDefaultOpenAIProfile({ id: 'openai-preset', baseUrl: 'https://preset.example.com/v1' })],
    })
    expect(policy.getDefaultPresetBaseUrl()).toBe('https://preset.example.com/v1')

    policy.setPresetConfig({
      customProviders: [],
      profiles: [createDefaultFalProfile({ id: 'fal-preset', baseUrl: 'https://fal-proxy.example.com' })],
    })
    expect(policy.getDefaultPresetBaseUrl()).toBe('')
  })
})
