package restart.service;

import java.io.IOException;
import java.nio.ByteBuffer;

import javax.annotation.PostConstruct;
import javax.ejb.Stateless;
import javax.enterprise.inject.Default;
import javax.inject.Inject;

import com.google.protobuf.InvalidProtocolBufferException;

import restart.data.IProtobufRepository;
import restart.data.IProtobufRepository.IProtobufIndex;
import restart.protobufs.Restart.*;

@Default
@Stateless
public class RestartService implements IRestartService {

	@Inject private IProtobufRepository<Test> tests;
	private IProtobufIndex<Integer, Test> testById;
	
	@PostConstruct
	public void configure() {
		tests.configure( 
			(x) -> {
					try {
						return Test.parseFrom(x);
					} catch (InvalidProtocolBufferException ex){
						return Test.newBuilder().build();
					}
				}
		);
		
		testById = tests.configureIndex(
			"id",
			(k) -> Test.newBuilder().setId(k).build(),
			(v) -> v.getId(),
			(k) -> ByteBuffer.allocate(4).putInt(k).array()
		);
	}
	
	@Override
	public TestOrBuilder getData() {
		Test test = testById.query().atKey(1).firstOrDefault();
		
		test = tests.put(Test.newBuilder(test).setGreeting(test.getGreeting()+" :) ").build());
		
		return test;
	}
	
	@Override
	public void close() throws Exception {
		// TODO Auto-generated method stub

	}
}
