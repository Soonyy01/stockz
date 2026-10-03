// Privy login (wallets + email/Google/X with an embedded wallet). Loaded as an ES module from esm.sh, no build step.
// If no App ID is set, or Privy cannot load, Stockz silently keeps using the browser wallet (window.ethereum).
const C = window.FLAPCITY_CONFIG;
if (C.privyAppId) {
  try {
    const REACT = 'react@18.3.1', DOM = 'react-dom@18.3.1';
    const [React, ReactDOM, Privy, chains] = await Promise.all([
      import(`https://esm.sh/${REACT}`),
      import(`https://esm.sh/${DOM}/client?deps=${REACT}`),
      import(`https://esm.sh/@privy-io/react-auth@2?deps=${REACT},${DOM}`),
      import('https://esm.sh/viem@2/chains')
    ]);
    const { PrivyProvider, usePrivy, useWallets, useLogin } = Privy;
    const h = React.createElement;
    const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

    function Bridge() {
      const { ready, authenticated, logout } = usePrivy();
      const { wallets } = useWallets();
      const { login } = useLogin({
        onComplete: () => emit('stockz:privy-login', { ok: true }),
        onError: err => emit('stockz:privy-login', { ok: false, error: String(err || 'login cancelled') })
      });
      React.useEffect(() => {
        const w = wallets && wallets[0];
        window.StockzPrivy = {
          ready, authenticated, login, logout,
          address: w ? w.address : null,
          async provider() {
            const x = (window.StockzPrivy._wallets || [])[0];
            if (!x) throw new Error('No wallet is connected yet.');
            try { await x.switchChain(56); } catch (e) { /* the wallet may already be on BNB Chain */ }
            return await x.getEthereumProvider();
          },
          _wallets: wallets
        };
        emit('stockz:privy', { address: w ? w.address : null, authenticated });
      }, [ready, authenticated, wallets]);
      return null;
    }

    const host = document.createElement('div'); host.id = 'privy-root'; document.body.appendChild(host);
    ReactDOM.createRoot(host).render(h(PrivyProvider, {
      appId: C.privyAppId,
      config: {
        loginMethods: ['wallet', 'email', 'google', 'twitter'],
        appearance: { theme: 'light', accentColor: '#f4b400', logo: new URL('logo.png', location.href).href, walletChainType: 'ethereum-only' },
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        defaultChain: chains.bsc,
        supportedChains: [chains.bsc]
      }
    }, h(Bridge)));
  } catch (e) {
    console.warn('[Stockz] Privy could not load, using the browser wallet instead:', e);
    window.StockzPrivy = null;
  }
}
