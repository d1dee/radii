import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/charts/styles.css';

import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { AppLayout } from '@/components/Layout/AppLayout';
import DashboardPage from '@/pages/DashboardPage';
import NasDeviceFormPage from '@/pages/NasDeviceFormPage';
import NasDevicesPage from '@/pages/NasDevicesPage';
import PackageFormPage from '@/pages/PackageFormPage';
import PackagesPage from '@/pages/PackagesPage';
import PaymentsPage from '@/pages/PaymentsPage';
import ReportsPage from '@/pages/ReportsPage';
import SessionsPage from '@/pages/SessionsPage';
import UsersPage from '@/pages/UsersPage';

export default function App() {
    return (
        <MantineProvider defaultColorScheme='auto'>
            <Notifications />
            <BrowserRouter>
                <AppLayout>
                    <Routes>
                        <Route path='/' element={<DashboardPage />} />
                        <Route path='/users' element={<UsersPage />} />
                        <Route path='/payments' element={<PaymentsPage />} />
                        <Route path='/sessions' element={<SessionsPage />} />
                        <Route path='/reports' element={<ReportsPage />} />
                        <Route path='/packages' element={<PackagesPage />} />
                        <Route
                            path='/packages/add'
                            element={<PackageFormPage />}
                        />
                        <Route
                            path='/packages/:id/edit'
                            element={<PackageFormPage />}
                        />
                        <Route
                            path='/nas-devices'
                            element={<NasDevicesPage />}
                        />
                        <Route
                            path='/nas-devices/add'
                            element={<NasDeviceFormPage />}
                        />
                        <Route
                            path='/nas-devices/:id/edit'
                            element={<NasDeviceFormPage />}
                        />
                    </Routes>
                </AppLayout>
            </BrowserRouter>
        </MantineProvider>
    );
}
