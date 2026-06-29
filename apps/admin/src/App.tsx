import { MantineProvider } from '@mantine/core';
import { Route, Routes } from 'react-router-dom';
import { AdminLayout } from './components/AdminLayout/AdminLayout';
import { AuthLayout } from './components/AdminLayout/AuthLayout';
import Dashboard from './routes/Dashboard';
import Login from './routes/Login';
import Packages from './routes/Packages';
import Signup from './routes/Signup';

function LayoutWrapper({ children }: { children: React.ReactNode }) {
    return (
        <AuthLayout>
            <AdminLayout>{children}</AdminLayout>
        </AuthLayout>
    );
}

export default function App() {
    return (
        <MantineProvider>
            <Routes>
                <Route path='/login' element={<Login />} />
                <Route path='/signup' element={<Signup />} />
                <Route
                    path='/dashboard'
                    element={
                        <LayoutWrapper>
                            <Dashboard />
                        </LayoutWrapper>
                    }
                />
                <Route
                    path='/packages'
                    element={
                        <LayoutWrapper>
                            <Packages />
                        </LayoutWrapper>
                    }
                />
                <Route path='/' element={<Login />} />
            </Routes>
        </MantineProvider>
    );
}
