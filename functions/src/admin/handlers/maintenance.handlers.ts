import { HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { onAdminCall } from '../../shared/auth';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import { MaintenanceStatusResponse, SetMaintenanceModeRequest, SetMaintenanceModeResponse } from '../shared/types';

/**
 * Sets the maintenance mode status using Firebase Remote Config Parameter Groups.
 * Remote Config is the single source of truth for maintenance state.
 * Each environment (prod, beta, dev) has its own parameters within the 'maintenance' group.
 */
export const setMaintenanceMode = onAdminCall<SetMaintenanceModeRequest, SetMaintenanceModeResponse>({
    region: FUNCTIONS_MANIFEST.setMaintenanceMode.region,
    memory: '256MiB',
}, async (request) => {
    try {
        const data = request.data;
        const env = data.env || 'prod';
        const msg = data.message || '';

        const rc = admin.remoteConfig();
        const template = await rc.getTemplate();

        // Initialize parameterGroups if not exists
        template.parameterGroups = template.parameterGroups || {};

        // Create or get the 'maintenance' parameter group
        const groupKey = 'maintenance';
        if (!template.parameterGroups[groupKey]) {
            template.parameterGroups[groupKey] = {
                description: 'Maintenance mode settings for each environment',
                parameters: {}
            };
        }

        const group = template.parameterGroups[groupKey];

        // Set the enabled parameter for this environment
        group.parameters[`${env}_enabled`] = {
            defaultValue: { value: String(data.enabled) },
            description: `Maintenance mode enabled for ${env}`,
            valueType: 'BOOLEAN' as never
        };

        // Set the message parameter for this environment
        group.parameters[`${env}_message`] = {
            defaultValue: { value: msg },
            description: `Maintenance message for ${env}`,
            valueType: 'STRING' as never
        };

        // Validate and publish
        await rc.validateTemplate(template);
        await rc.publishTemplate(template);

        logger.info(`Maintenance mode [${env}] ${data.enabled ? 'ENABLED' : 'DISABLED'} by ${request.auth!.uid}`);

        return {
            success: true,
            enabled: data.enabled,
            message: msg,
            env
        };
    } catch (error: unknown) {
        logger.error('Error setting maintenance mode:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to set maintenance mode';
        throw new HttpsError('internal', errorMessage);
    }
});

/**
 * Gets the current maintenance mode status from Remote Config Parameter Groups.
 */
export const getMaintenanceStatus = onAdminCall<void, MaintenanceStatusResponse>({
    region: FUNCTIONS_MANIFEST.getMaintenanceStatus.region,
    memory: '256MiB',
}, async () => {
    try {
        const rc = admin.remoteConfig();
        const template = await rc.getTemplate();

        // Read from the 'maintenance' parameter group
        const groupKey = 'maintenance';
        const group = template.parameterGroups?.[groupKey];
        const params = group?.parameters || {};

        const getStatusData = (env: string) => {
            const enabledParam = params[`${env}_enabled`];
            const messageParam = params[`${env}_message`];

            // Get enabled value
            let enabled = false;
            if (enabledParam?.defaultValue && 'value' in enabledParam.defaultValue) {
                enabled = enabledParam.defaultValue.value === 'true';
            }

            // Get message
            let message = '';
            if (messageParam?.defaultValue && 'value' in messageParam.defaultValue) {
                message = messageParam.defaultValue.value || '';
            }

            return { enabled, message };
        };

        return {
            prod: getStatusData('prod'),
            beta: getStatusData('beta'),
            dev: getStatusData('dev')
        };
    } catch (error: unknown) {
        logger.error('Error getting maintenance status:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to get maintenance status';
        throw new HttpsError('internal', errorMessage);
    }
});
