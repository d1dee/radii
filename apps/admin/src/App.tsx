import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'

import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { AppLayout } from '@/components/Layout/AppLayout'
import DashboardPage from '@/pages/DashboardPage'
import PackageFormPage from '@/pages/PackageFormPage'
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
                        <Route path='/packages/add' element={<PackageFormPage />} />
                        <Route path='/packages/:id/edit' element={<PackageFormPage />} />
                    </Routes>
                </AppLayout>
            </BrowserRouter>
        </MantineProvider>
    )
}
