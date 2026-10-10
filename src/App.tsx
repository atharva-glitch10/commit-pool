import { useRoute } from './router'
import { Footer, TopBar } from './ui'
import { Landing } from './Landing'
import { Start } from './Start'
import { Dashboard, Leaderboard } from './Dashboard'
import { PoolPage } from './PoolPage'
import { Pledge } from './Pledge'
import { Feed } from './Feed'
import { Verification } from './Verification'

export default function App() {
  const route = useRoute()
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <TopBar route={route} />
      <main id="main" className={`page-${route.name}`}>
        {route.name === 'home' && <Landing />}
        {route.name === 'start' && <Start next={route.next} />}
        {route.name === 'app' && <Dashboard />}
        {route.name === 'board' && <Leaderboard />}
        {route.name === 'trust' && <Verification />}
        {route.name === 'pool' && <PoolPage id={route.id} key={route.id.toString()} />}
        {route.name === 'new' && (
          <div className="dash">
            <div className="dashmain"><Pledge /></div>
            <aside className="side"><Feed /></aside>
          </div>
        )}
      </main>
      <Footer />
    </>
  )
}
