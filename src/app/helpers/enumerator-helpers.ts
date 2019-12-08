export class EnumeratorHelpers {
  static getNumericEnumKeyValue(enumerator) {
    return Object.keys(enumerator).slice(Object.keys(enumerator).length / 2)
      .reduce((obj, key) => {
        obj[`${enumerator[key]} - ${key}`] = enumerator[key];
        return obj
      }, {});
  }
}
