const mix = (superclass) => new MixinBuilder(superclass);

class MixinBuilder {
  private superclass;
  constructor(superclass) {
    this.superclass = superclass;
  }

  with(...mixins) {
    return mixins.reduce((c, mixin) => mixin(c), this.superclass);
  }
}
