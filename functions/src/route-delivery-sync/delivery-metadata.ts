import { ServiceNames } from '@sports-alliance/sports-lib';
import { RouteDeliverySyncRouteId } from '../../../shared/route-delivery-sync-routes';

export async function hasSuccessfulRouteDeliveryMetadataForRevision(params: {
    routeRef: FirebaseFirestore.DocumentReference;
    routeId: RouteDeliverySyncRouteId;
    destinationServiceName: ServiceNames;
    sourceRevisionKey: string;
}): Promise<boolean> {
    const metadataSnapshot = await params.routeRef.collection('metaData').get();
    return metadataSnapshot.docs.some(docSnapshot => {
        const data = docSnapshot.data();
        return data?.serviceName === params.destinationServiceName
            && data?.status === 'success'
            && data?.routeSyncRouteId === params.routeId
            && data?.sourceRevisionKey === params.sourceRevisionKey;
    });
}
