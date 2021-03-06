import UIKit

@IBDesignable
class TextView: UITextView, DtcViewProtocol {
    typealias PropType = TextViewProps
    var props: PropType?

    @IBInspectable var containerColor: UIColor = UIColor(red: 242/255, green: 97/255, blue: 97/255, alpha: 1) {
        didSet {
            backgroundColor = containerColor
        }
    }
    @IBInspectable var cornerRadius: CGFloat = 0 {
        didSet {
            layer.cornerRadius = cornerRadius
        }
    }

    override init(frame: CGRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)
        commonInit()
    }

    required init?(coder aDecoder: NSCoder) {
        super.init(coder: aDecoder)
    }

    override func awakeFromNib() {
        super.awakeFromNib()
        commonInit()
    }

    override func prepareForInterfaceBuilder() {
        super.prepareForInterfaceBuilder()
        commonInit()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // need to redraw after subviews are autoresized
        if (self.props?.backgroundColor == nil) {
            self.adoptFillsIfNeeded(self.props?.fills)
        }
        self.adoptShadowsIfNeeded(self.props?.shadows)
    }
    
    private func commonInit() {
        layer.masksToBounds = true
        isExclusiveTouch = true
        backgroundColor = containerColor
        layer.cornerRadius = cornerRadius
    }

    func assign(props: PropType?) {
        self.props = props
        guard let props = self.props else { return }

        self.isHidden = !props.isVisible
        self.containerColor = props.backgroundColor?.uiColor ?? UIColor.clear
        self.cornerRadius = props.radius ?? 0

        if (props.backgroundColor == nil) {
            self.adoptFillsIfNeeded(props.fills)
        }
        self.adoptShadowsIfNeeded(props.shadows)

        self.text = props.text
        self.isEditable = props.isEditable ?? false

        if let textStyle = props.textStyle {
            self.font = textStyle.uiFont
            self.textColor = textStyle.fontColor?.uiColor

            if let alignment = textStyle.alignment {
                var hAlign: NSTextAlignment = .center
                switch alignment {
                case .right:
                    hAlign = .right
                case .center:
                    hAlign = .center
                case .left:
                    hAlign = .left
                case .equalWidth:
                    hAlign = .justified
                }
                self.textAlignment = hAlign
            }

            // todo: textContainerInset を設定可能にしたほうがいいかも


        }
    }

}
