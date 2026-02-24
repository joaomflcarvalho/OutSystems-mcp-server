import { getValidOutSystemsToken } from '../src/services/token-manager';

async function runTest() {
    console.log('Attempting to get token...');
    try {
        const token = await getValidOutSystemsToken();
        console.log('SUCCESS! Token received:', token);
    } catch (error) {
        console.error('FAILED to get token:', error);
    }
}

runTest();
