import { Routes, Route } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { StoreProvider } from '@/lib/store'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import ApiList from '@/pages/ApiList'
import ApiForm from '@/pages/ApiForm'
import ApiDetail from '@/pages/ApiDetail'
import Groups from '@/pages/Groups'
import Apps from '@/pages/Apps'
import Monitor from '@/pages/Monitor'

export default function App() {
  return (
    <StoreProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/apis" element={<ApiList />} />
          <Route path="/apis/new" element={<ApiForm />} />
          <Route path="/apis/:id" element={<ApiDetail />} />
          <Route path="/apis/:id/edit" element={<ApiForm />} />
          <Route path="/groups" element={<Groups />} />
          <Route path="/apps" element={<Apps />} />
          <Route path="/monitor" element={<Monitor />} />
        </Route>
      </Routes>
      <Toaster richColors position="top-right" />
    </StoreProvider>
  )
}
