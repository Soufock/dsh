/** Login-page copy; locale selection is limited to English and simplified Chinese. */
export const dictionaries = {
  en: {
    title: 'Administrator sign in', subtitle: 'Sign in to your DeepSeek Harness workspace',
    username: 'Username', password: 'Password', submit: 'Sign in', pending: 'Signing in…',
    token: 'You can also open the token link printed by dsh to sign in as the administrator.',
    invalid: 'Incorrect username or password', limited: 'Too many attempts. Please try again shortly.',
    unavailable: 'Sign in is unavailable. Check the administrator password file and try again.',
    malformed: 'Invalid sign-in request. Reload this page and try again.',
  },
  'zh-CN': {
    title: '管理员登录', subtitle: '登录你的 DeepSeek Harness 工作区',
    username: '账号', password: '密码', submit: '登录', pending: '正在登录…',
    token: '也可以打开 dsh 启动时输出的 token 链接，以管理员身份登录',
    invalid: '账号或密码错误', limited: '尝试次数过多，请稍后重试',
    unavailable: '登录暂不可用，请检查管理员密码文件后重试',
    malformed: '登录请求无效，请刷新页面后重试',
  },
}

/**
 * Select the first supported browser language, respecting preference order and q=0.
 * @param {string | undefined} header Accept-Language header.
 * @returns {'en' | 'zh-CN'} Supported language.
 */
export function selectLocale(header) {
  const preferences = (header || '').split(',').map((part, order) => {
    const [tag, ...params] = part.trim().toLowerCase().split(';')
    const quality = params.find(value => value.trim().startsWith('q='))
    return { tag, order, q: quality ? Number(quality.trim().slice(2)) : 1 }
  }).filter(value => Number.isFinite(value.q) && value.q > 0 && value.q <= 1)
    .sort((a, b) => b.q - a.q || a.order - b.order)
  for (const { tag } of preferences) {
    if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-CN'
    if (tag === 'en' || tag.startsWith('en-')) return 'en'
  }
  return 'en'
}
