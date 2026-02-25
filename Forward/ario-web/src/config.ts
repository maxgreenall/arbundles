import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

export const config = createConfig({
  chains: [mainnet],
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(),
  },
})

export const ARIO_PROCESS = 'qNvAoz0TgcH7DMg8BCVn8jF32QH5L6T29VjHxhHqqGE'
export const MU_URL = 'https://mu.ao-testnet.xyz'
export const CU_URL = 'https://cu.ardrive.io'
