import create, { State } from 'zustand'
import produce from 'immer'
import { Market } from '@project-serum/serum'
import {
  IDS,
  Config,
  MangoClient,
  MangoGroup,
  MangoAccount,
  MarketConfig,
  getMarketByBaseSymbolAndKind,
  GroupConfig,
  TokenConfig,
  getTokenAccountsByOwnerWithWrappedSol,
  getTokenByMint,
  TokenAccount,
  nativeToUi,
  MangoCache,
  PerpMarket,
  getAllMarkets,
  getMultipleAccounts,
  PerpMarketLayout,
  msrmMints,
} from '@blockworks-foundation/mango-client'
import { AccountInfo, Commitment, Connection, PublicKey } from '@solana/web3.js'
import { EndpointInfo, WalletAdapter } from '../@types/types'
import { isDefined, zipDict } from '../utils'
import { notify } from '../utils/notifications'
import { LAST_ACCOUNT_KEY } from '../components/AccountsModal'
import {
  DEFAULT_MARKET_KEY,
  initialMarket,
  NODE_URL_KEY,
} from '../components/SettingsModal'
import { MSRM_DECIMALS } from '@project-serum/serum/lib/token-instructions'

export const ENDPOINTS: EndpointInfo[] = [
  {
    name: 'mainnet',
    url: process.env.NEXT_PUBLIC_ENDPOINT || 'https://mango.rpcpool.com',
    websocket: process.env.NEXT_PUBLIC_ENDPOINT || 'https://mango.rpcpool.com',
    custom: false,
  },
  {
    name: 'devnet',
    // url: 'https://mango.devnet.rpcpool.com',
    // websocket: 'https://mango.devnet.rpcpool.com',
    url: 'https://api.devnet.solana.com',
    websocket: 'https://api.devnet.solana.com',
    custom: false,
  },
]

type ClusterType = 'mainnet' | 'devnet'

const CLUSTER = (process.env.NEXT_PUBLIC_CLUSTER as ClusterType) || 'mainnet'
const ENDPOINT = ENDPOINTS.find((e) => e.name === CLUSTER)

export const WEBSOCKET_CONNECTION = new Connection(
  ENDPOINT.websocket,
  'processed' as Commitment
)

const DEFAULT_MANGO_GROUP_NAME = process.env.NEXT_PUBLIC_GROUP || 'mainnet.1'
export const DEFAULT_MANGO_GROUP_CONFIG = Config.ids().getGroup(
  CLUSTER,
  DEFAULT_MANGO_GROUP_NAME
)
const defaultMangoGroupIds = IDS['groups'].find(
  (group) => group.name === DEFAULT_MANGO_GROUP_NAME
)
export const MNGO_INDEX = defaultMangoGroupIds.oracles.findIndex(
  (t) => t.symbol === 'MNGO'
)

export const programId = new PublicKey(defaultMangoGroupIds.mangoProgramId)
export const serumProgramId = new PublicKey(defaultMangoGroupIds.serumProgramId)
const mangoGroupPk = new PublicKey(defaultMangoGroupIds.publicKey)

export const INITIAL_STATE = {
  WALLET: {
    providerUrl: null,
    connected: false,
    current: null,
    tokens: [],
  },
}

// an object with keys of Solana account addresses that we are
// subscribing to with connection.onAccountChange() in the
// useHydrateStore hook
interface AccountInfoList {
  [key: string]: AccountInfo<Buffer>
}

export interface WalletToken {
  account: TokenAccount
  config: TokenConfig
  uiBalance: number
}

export interface Orderbook {
  bids: number[][]
  asks: number[][]
}

export interface Alert {
  acc: PublicKey
  alertProvider: 'mail'
  health: number
  _id: string
  open: boolean
  timestamp: number
  triggeredTimestamp: number | undefined
}

interface AlertRequest {
  alertProvider: 'mail'
  health: number
  mangoGroupPk: string
  mangoAccountPk: string
  email: string | undefined
}

interface MangoStore extends State {
  notifications: Array<{
    type: string
    title: string
    description?: string
    txid?: string
  }>
  accountInfos: AccountInfoList
  connection: {
    cluster: ClusterType
    current: Connection
    websocket: Connection
    endpoint: string
    client: MangoClient
    slot: number
  }
  selectedMarket: {
    config: MarketConfig
    current: Market | PerpMarket | null
    markPrice: number
    kind: string
    askInfo: AccountInfo<Buffer> | null
    bidInfo: AccountInfo<Buffer> | null
    orderBook: Orderbook
    fills: any[]
  }
  mangoGroups: Array<MangoGroup>
  selectedMangoGroup: {
    config: GroupConfig
    name: string
    current: MangoGroup | null
    markets: {
      [address: string]: Market | PerpMarket
    }
    cache: MangoCache | null
  }
  mangoAccounts: MangoAccount[]
  selectedMangoAccount: {
    current: MangoAccount | null
    initialLoad: boolean
    lastUpdatedAt: number
  }
  tradeForm: {
    side: 'buy' | 'sell'
    price: number | ''
    baseSize: number | ''
    quoteSize: number | ''
    tradeType:
      | 'Market'
      | 'Limit'
      | 'Stop Loss'
      | 'Take Profit'
      | 'Stop Limit'
      | 'Take Profit Limit'
    triggerPrice: number | ''
    triggerCondition: 'above' | 'below'
  }
  wallet: {
    providerUrl: string
    connected: boolean
    current: WalletAdapter | undefined
    tokens: WalletToken[]
  }
  settings: {
    uiLocked: boolean
  }
  tradeHistory: any[]
  set: (x: any) => void
  actions: {
    [key: string]: (args?) => void
  }
  alerts: {
    activeAlerts: Array<Alert>
    triggeredAlerts: Array<Alert>
    loading: boolean
    error: string
    submitting: boolean
    success: string
  }
}

const useMangoStore = create<MangoStore>((set, get) => {
  const rpcUrl =
    typeof window !== 'undefined' && CLUSTER === 'mainnet'
      ? JSON.parse(localStorage.getItem(NODE_URL_KEY)) || ENDPOINT.url
      : ENDPOINT.url

  const defaultMarket =
    typeof window !== 'undefined'
      ? JSON.parse(localStorage.getItem(DEFAULT_MARKET_KEY)) || initialMarket
      : initialMarket

  const connection = new Connection(rpcUrl, 'processed' as Commitment)
  return {
    notifications: [],
    accountInfos: {},
    connection: {
      cluster: CLUSTER,
      current: connection,
      websocket: WEBSOCKET_CONNECTION,
      client: new MangoClient(connection, programId),
      endpoint: ENDPOINT.url,
      slot: 0,
    },
    selectedMangoGroup: {
      config: DEFAULT_MANGO_GROUP_CONFIG,
      name: DEFAULT_MANGO_GROUP_NAME,
      current: null,
      markets: {},
      rootBanks: [],
      cache: null,
    },
    selectedMarket: {
      config: getMarketByBaseSymbolAndKind(
        DEFAULT_MANGO_GROUP_CONFIG,
        defaultMarket.base,
        defaultMarket.kind
      ) as MarketConfig,
      kind: defaultMarket.kind,
      current: null,
      markPrice: 0,
      askInfo: null,
      bidInfo: null,
      orderBook: { bids: [], asks: [] },
      fills: [],
    },
    mangoGroups: [],
    mangoAccounts: [],
    selectedMangoAccount: {
      current: null,
      initialLoad: true,
      lastUpdatedAt: 0,
    },
    tradeForm: {
      side: 'buy',
      baseSize: '',
      quoteSize: '',
      tradeType: 'Limit',
      price: '',
      triggerPrice: '',
      triggerCondition: 'above',
    },
    wallet: INITIAL_STATE.WALLET,
    settings: {
      uiLocked: true,
    },
    alerts: {
      activeAlerts: [],
      triggeredAlerts: [],
      loading: false,
      error: '',
      submitting: false,
      success: '',
    },
    tradeHistory: [],
    set: (fn) => set(produce(fn)),
    actions: {
      async fetchWalletTokens() {
        const groupConfig = get().selectedMangoGroup.config
        const wallet = get().wallet.current
        const connected = get().wallet.connected
        const connection = get().connection.current
        const cluster = get().connection.cluster
        const set = get().set

        if (wallet?.publicKey && connected) {
          const ownedTokenAccounts =
            await getTokenAccountsByOwnerWithWrappedSol(
              connection,
              wallet.publicKey
            )
          const tokens = []
          ownedTokenAccounts.forEach((account) => {
            const config = getTokenByMint(groupConfig, account.mint)
            if (config) {
              const uiBalance = nativeToUi(account.amount, config.decimals)
              tokens.push({ account, config, uiBalance })
            } else if (msrmMints[cluster].equals(account.mint)) {
              const uiBalance = nativeToUi(account.amount, 6)
              tokens.push({
                account,
                config: {
                  symbol: 'MSRM',
                  mintKey: msrmMints[cluster],
                  decimals: MSRM_DECIMALS,
                },
                uiBalance,
              })
            }
          })

          set((state) => {
            state.wallet.tokens = tokens
          })
        } else {
          set((state) => {
            state.wallet.tokens = []
          })
        }
      },
      async fetchAllMangoAccounts() {
        const set = get().set
        const mangoGroup = get().selectedMangoGroup.current
        const mangoClient = get().connection.client
        const wallet = get().wallet.current
        const walletPk = wallet?.publicKey

        if (!walletPk) return
        return mangoClient
          .getMangoAccountsForOwner(mangoGroup, walletPk, true)
          .then((mangoAccounts) => {
            if (mangoAccounts.length > 0) {
              const sortedAccounts = mangoAccounts
                .slice()
                .sort((a, b) =>
                  a.publicKey.toBase58() > b.publicKey.toBase58() ? 1 : -1
                )

              set((state) => {
                state.selectedMangoAccount.initialLoad = false
                state.mangoAccounts = sortedAccounts
                if (!state.selectedMangoAccount.current) {
                  const lastAccount = localStorage.getItem(LAST_ACCOUNT_KEY)
                  state.selectedMangoAccount.current =
                    mangoAccounts.find(
                      (ma) =>
                        ma.publicKey.toString() === JSON.parse(lastAccount)
                    ) || sortedAccounts[0]
                }
              })
            } else {
              set((state) => {
                state.selectedMangoAccount.initialLoad = false
              })
            }
          })
          .catch((err) => {
            notify({
              type: 'error',
              title: 'Unable to load mango account',
              description: err.message,
            })
            console.log('Could not get margin accounts for wallet', err)
          })
      },
      async fetchMangoGroup() {
        const set = get().set
        const mangoGroupConfig = get().selectedMangoGroup.config
        const selectedMarketConfig = get().selectedMarket.config
        const mangoClient = get().connection.client
        const connection = get().connection.current

        return mangoClient
          .getMangoGroup(mangoGroupPk)
          .then(async (mangoGroup) => {
            const allMarketConfigs = getAllMarkets(mangoGroupConfig)
            const allMarketPks = allMarketConfigs.map((m) => m.publicKey)

            let allMarketAccountInfos, mangoCache
            try {
              const resp = await Promise.all([
                getMultipleAccounts(connection, allMarketPks),
                mangoGroup.loadCache(connection),
                mangoGroup.loadRootBanks(connection),
              ])
              allMarketAccountInfos = resp[0]
              mangoCache = resp[1]
            } catch {
              notify({
                type: 'error',
                title: 'Failed to load the mango group. Please refresh.',
              })
            }

            const allMarketAccounts = allMarketConfigs.map((config, i) => {
              if (config.kind == 'spot') {
                const decoded = Market.getLayout(programId).decode(
                  allMarketAccountInfos[i].accountInfo.data
                )
                return new Market(
                  decoded,
                  config.baseDecimals,
                  config.quoteDecimals,
                  undefined,
                  mangoGroupConfig.serumProgramId
                )
              }
              if (config.kind == 'perp') {
                const decoded = PerpMarketLayout.decode(
                  allMarketAccountInfos[i].accountInfo.data
                )
                return new PerpMarket(
                  config.publicKey,
                  config.baseDecimals,
                  config.quoteDecimals,
                  decoded
                )
              }
            })

            const allBidsAndAsksPks = allMarketConfigs
              .map((m) => [m.bidsKey, m.asksKey])
              .flat()
            const allBidsAndAsksAccountInfos = await getMultipleAccounts(
              connection,
              allBidsAndAsksPks
            )

            const allMarkets = zipDict(
              allMarketPks.map((pk) => pk.toBase58()),
              allMarketAccounts
            )

            set((state) => {
              state.selectedMangoGroup.current = mangoGroup
              state.selectedMangoGroup.cache = mangoCache
              state.selectedMangoGroup.markets = allMarkets
              state.selectedMarket.current =
                allMarkets[selectedMarketConfig.publicKey.toBase58()]

              allMarketAccountInfos
                .concat(allBidsAndAsksAccountInfos)
                .forEach(({ publicKey, context, accountInfo }) => {
                  if (context.slot >= state.connection.slot) {
                    state.connection.slot = context.slot
                    state.accountInfos[publicKey.toBase58()] = accountInfo
                  }
                })
            })
          })
          .catch((err) => {
            notify({
              title: 'Could not get mango group',
              description: `${err}`,
              type: 'error',
            })
            console.log('Could not get mango group: ', err)
          })
      },
      async fetchTradeHistory(mangoAccount = null) {
        const selectedMangoAccount =
          mangoAccount || get().selectedMangoAccount.current
        const set = get().set
        if (!selectedMangoAccount) return

        let serumTradeHistory = []
        if (selectedMangoAccount.spotOpenOrdersAccounts.length) {
          const openOrdersAccounts =
            selectedMangoAccount.spotOpenOrdersAccounts.filter(isDefined)
          const publicKeys = openOrdersAccounts.map((act) =>
            act.publicKey.toString()
          )
          serumTradeHistory = await Promise.all(
            publicKeys.map(async (pk) => {
              const response = await fetch(
                `https://event-history-api.herokuapp.com/trades/open_orders/${pk.toString()}`
              )
              const parsedResponse = await response.json()
              return parsedResponse?.data ? parsedResponse.data : []
            })
          )
        }
        const perpHistory = await fetch(
          `https://event-history-api.herokuapp.com/perp_trades/${selectedMangoAccount.publicKey.toString()}`
        )
        let parsedPerpHistory = await perpHistory.json()
        parsedPerpHistory = parsedPerpHistory?.data || []

        set((state) => {
          state.tradeHistory = [...serumTradeHistory, ...parsedPerpHistory]
        })
      },
      async reloadMangoAccount() {
        const set = get().set
        const mangoAccount = get().selectedMangoAccount.current
        const connection = get().connection.current
        const mangoClient = get().connection.client

        const reloadedMangoAccount = await mangoAccount.reloadFromSlot(
          connection,
          mangoClient.lastSlot
        )

        set((state) => {
          state.selectedMangoAccount.current = reloadedMangoAccount
          state.selectedMangoAccount.lastUpdatedAt = new Date().toISOString()
        })
        console.log('reloaded mango account', reloadedMangoAccount)
      },
      async reloadOrders() {
        const mangoAccount = get().selectedMangoAccount.current
        const connection = get().connection.current
        if (mangoAccount) {
          await Promise.all([
            mangoAccount.loadOpenOrders(
              connection,
              new PublicKey(serumProgramId)
            ),
            mangoAccount.loadAdvancedOrders(connection),
          ])
        }
      },
      async updateOpenOrders() {
        const set = get().set
        const connection = get().connection.current
        const bidAskAccounts = Object.keys(get().accountInfos).map(
          (pk) => new PublicKey(pk)
        )

        const allBidsAndAsksAccountInfos = await getMultipleAccounts(
          connection,
          bidAskAccounts
        )

        set((state) => {
          allBidsAndAsksAccountInfos.forEach(
            ({ publicKey, context, accountInfo }) => {
              state.connection.slot = context.slot
              state.accountInfos[publicKey.toBase58()] = accountInfo
            }
          )
        })
      },
      async loadMarketFills() {
        const set = get().set
        const selectedMarket = get().selectedMarket.current
        const connection = get().connection.current
        if (!selectedMarket) {
          return null
        }
        try {
          const loadedFills = await selectedMarket.loadFills(connection, 10000)
          set((state) => {
            state.selectedMarket.fills = loadedFills
          })
        } catch (err) {
          console.log('Error fetching fills:', err)
        }
      },
      async fetchMangoGroupCache() {
        const set = get().set
        const mangoGroup = get().selectedMangoGroup.current
        const connection = get().connection.current
        if (mangoGroup) {
          const mangoCache = await mangoGroup.loadCache(connection)

          set((state) => {
            state.selectedMangoGroup.cache = mangoCache
          })
        }
      },
      async updateConnection(endpointUrl) {
        const set = get().set

        const newConnection = new Connection(endpointUrl, 'processed')

        const newClient = new MangoClient(newConnection, programId)

        set((state) => {
          state.connection.endpoint = endpointUrl
          state.connection.current = newConnection
          state.connection.client = newClient
        })
      },
      async createAlert(req: AlertRequest) {
        const set = get().set
        const alert = {
          acc: new PublicKey(req.mangoAccountPk),
          alertProvider: req.alertProvider,
          health: req.health,
          open: true,
          timestamp: Date.now(),
        }

        set((state) => {
          state.alerts.submitting = true
          state.alerts.error = ''
          state.alerts.success = ''
        })

        const fetchUrl = `http://localhost:3010/alerts`
        const headers = { 'Content-Type': 'application/json' }

        fetch(fetchUrl, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(req),
        })
          .then((response: any) => {
            if (!response.ok) {
              throw response
            }
            return response.json()
          })
          .then(() => {
            const alerts = get().alerts.activeAlerts

            set((state) => {
              state.alerts.activeAlerts = [alert as Alert].concat(alerts)
              state.alerts.success = 'Alert saved'
            })
            notify({
              title: 'Alert saved',
              type: 'success',
            })
          })
          .catch((err) => {
            if (typeof err.text === 'function') {
              err.text().then((errorMessage: string) => {
                set((state) => {
                  state.alerts.error = errorMessage
                })
                notify({
                  title: errorMessage,
                  type: 'error',
                })
              })
            } else {
              set((state) => {
                state.alerts.error = 'Something went wrong'
              })
              notify({
                title: 'Something went wrong',
                type: 'error',
              })
            }
          })
          .finally(() => {
            set((state) => {
              state.alerts.submitting = false
            })
          })
      },
      async deleteAlert(id: string) {
        const set = get().set

        set((state) => {
          state.alerts.submitting = true
          state.alerts.error = ''
          state.alerts.success = ''
        })

        const fetchUrl = `http://localhost:3010/delete-alert`
        const headers = { 'Content-Type': 'application/json' }

        fetch(fetchUrl, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ id: id }),
        })
          .then((response: any) => {
            if (!response.ok) {
              throw response
            }
            return response.json()
          })
          .then(() => {
            const alerts = get().alerts.activeAlerts

            set((state) => {
              state.alerts.activeAlerts = alerts.filter(
                (alert) => alert._id !== id
              )
              state.alerts.success = 'Alert deleted'
            })
            notify({
              title: 'Alert deleted',
              type: 'success',
            })
          })
          .catch((err) => {
            if (typeof err.text === 'function') {
              err.text().then((errorMessage: string) => {
                set((state) => {
                  state.alerts.error = errorMessage
                })
                notify({
                  title: errorMessage,
                  type: 'error',
                })
              })
            } else {
              set((state) => {
                state.alerts.error = 'Something went wrong'
              })
              notify({
                title: 'Something went wrong',
                type: 'error',
              })
            }
          })
          .finally(() => {
            set((state) => {
              state.alerts.submitting = false
            })
          })
      },
      async loadAlerts(mangoAccountPk: PublicKey) {
        const set = get().set

        set((state) => {
          state.alerts.loading = true
        })

        const headers = { 'Content-Type': 'application/json' }
        const response = await fetch(
          `http://localhost:3010/alerts/${mangoAccountPk}`,
          {
            method: 'GET',
            headers: headers,
          }
        )
          .then((response: any) => {
            if (!response.ok) {
              throw response
            }

            return response.json()
          })
          .catch((err) => {
            if (typeof err.text === 'function') {
              err.text().then((errorMessage: string) => {
                notify({
                  title: errorMessage,
                  type: 'error',
                })
              })
            } else {
              notify({
                title: 'Something went wrong',
                type: 'error',
              })
            }
          })

        // sort active by latest creation time first
        const activeAlerts = response.alerts
          .filter((alert) => alert.open)
          .sort((a, b) => {
            return b.timestamp - a.timestamp
          })

        // sort triggered by latest trigger time first
        const triggeredAlerts = response.alerts
          .filter((alert) => !alert.open)
          .sort((a, b) => {
            return b.triggeredTimestamp - a.triggeredTimestamp
          })

        set((state) => {
          state.alerts.activeAlerts = activeAlerts
          state.alerts.triggeredAlerts = triggeredAlerts
          state.alerts.loading = false
        })
      },
    },
  }
})

export default useMangoStore
