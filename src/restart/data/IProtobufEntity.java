package restart.data;

public interface IProtobufEntity<T extends com.google.protobuf.GeneratedMessage>  {
	public byte[] key();
	public T value();
}
