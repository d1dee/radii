import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { AppLayout } from '@/components/Layout/AppLayout';
import DashboardPage from '@/pages/DashboardPage';
import NasDeviceFormPage from '@/pages/NasDeviceFormPage';
import NasDevicesPage from '@/pages/NasDevicesPage';
import PackageFormPage from '@/pages/PackageFormPage';
import PackagesPage from '@/pages/PackagesPage';

export default function App() {
    return (
        <MantineProvider defaultColorScheme='auto'>
            <Notifications />
            <BrowserRouter>
                <AppLayout>
                    <Routes>
                        <Route path='/' element={<DashboardPage />} />
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
