import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'

import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { AppLayout } from '@/components/Layout/AppLayout'
import AddPackagePage from '@/pages/AddPackagePage'
import DashboardPage from '@/pages/DashboardPage'
import PackagesPage from '@/pages/PackagesPage'

export default function App() {
    return (
        <MantineProvider>
            <Notifications />
            <BrowserRouter>
                <AppLayout>
                    <Routes>
                        <Route path='/' element={<DashboardPage />} />
                        <Route path='/packages' element={<PackagesPage />} />
                        <Route path='/packages/add' element={<AddPackagePage />} />
                    </Routes>
                </AppLayout>
            </BrowserRouter>
        </MantineProvider>
    )
}
