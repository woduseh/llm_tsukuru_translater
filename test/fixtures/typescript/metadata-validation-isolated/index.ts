import { validateWolfExtDataPayload } from '../../../../src/ts/libs/metadataValidation';

const validated = validateWolfExtDataPayload({
  ext: [],
  meta: { ver: 3 },
  cache: {},
});

export default validated;
