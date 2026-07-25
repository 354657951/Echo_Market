import {
  createContext,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

type NavigateOptions = {
  replace?: boolean
}

type RouterValue = {
  pathname: string
  search: string
  navigate: (to: string, options?: NavigateOptions) => void
}

const RouterContext = createContext<RouterValue | null>(null)

function currentLocation() {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
  }
}

export function BrowserRouter({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(currentLocation)

  useEffect(() => {
    const syncLocation = () => setLocation(currentLocation())
    window.addEventListener('popstate', syncLocation)
    return () => window.removeEventListener('popstate', syncLocation)
  }, [])

  const value = useMemo<RouterValue>(() => ({
    ...location,
    navigate(to, options) {
      if (options?.replace) window.history.replaceState(null, '', to)
      else window.history.pushState(null, '', to)
      setLocation(currentLocation())
      window.scrollTo({ top: 0, behavior: 'instant' })
    },
  }), [location])

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

function useRouter() {
  const context = useContext(RouterContext)
  if (!context) throw new Error('Router must be used inside BrowserRouter')
  return context
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  to: string
}

export function Link({ children, onClick, target, to, ...props }: LinkProps) {
  const { navigate } = useRouter()

  function follow(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event)
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
      || target === '_blank'
    ) return
    event.preventDefault()
    navigate(to)
  }

  return <a {...props} href={to} onClick={follow} target={target}>{children}</a>
}

type NavLinkProps = Omit<LinkProps, 'className'> & {
  className?: string | ((state: { isActive: boolean }) => string)
  end?: boolean
}

export function NavLink({ className, end = false, to, ...props }: NavLinkProps) {
  const { pathname } = useRouter()
  const isActive = end
    ? pathname === to
    : pathname === to || (to !== '/' && pathname.startsWith(`${to}/`))
  const resolvedClassName = typeof className === 'function' ? className({ isActive }) : className
  return <Link {...props} aria-current={isActive ? 'page' : undefined} className={resolvedClassName} to={to} />
}

export function useNavigate() {
  return useRouter().navigate
}

export function useLocation() {
  const { pathname, search } = useRouter()
  return { pathname, search }
}

export function useParams() {
  const { pathname } = useRouter()
  const match = pathname.match(/^\/product\/([^/]+)\/?$/)
  return { id: match ? decodeURIComponent(match[1]) : undefined }
}

export function useSearchParams() {
  const { pathname, search, navigate } = useRouter()
  const params = useMemo(() => new URLSearchParams(search), [search])

  function setParams(
    next: URLSearchParams | Record<string, string>,
    options?: NavigateOptions,
  ) {
    const resolved = next instanceof URLSearchParams ? next : new URLSearchParams(next)
    const query = resolved.toString()
    navigate(query ? `${pathname}?${query}` : pathname, options)
  }

  return [params, setParams] as const
}
